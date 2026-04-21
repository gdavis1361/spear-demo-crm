import React from 'react';
import { ArrowRight, EyeOff, BellOff, Check } from 'lucide-react';
import { Noun } from '../components/nouns';
import type { NounRef, SignalId } from '../lib/types';
import { fromDisplayId, newIdempotencyKey } from '../lib/ids';
import { dismissSignal, actionSignal } from '../api/mutations';
import { track } from '../app/telemetry';
import { scheduleRegistry } from '../app/runtime';
import { ageShort } from '../lib/time';

type SignalKind = 'CYCLE' | 'COMPETITOR' | 'SIGNAL' | 'SPOUSE' | 'GSA' | 'PARTNER';
type SignalPriority = 'p0' | 'p1' | 'p2';

interface LinkedEntity {
  label: string;
  noun?: NounRef;
}

interface Signal {
  id: string;
  t?: string;
  priority: SignalPriority;
  kind: SignalKind;
  source: string;
  lane: string;
  laneNoun?: NounRef;
  headline: string;
  body: string;
  actor: string;
  age: string;
  linked: LinkedEntity[];
  action?: string;
}

type FilterKey = 'all' | SignalPriority | SignalKind;

// Signals feed — real-time intel surface. Vercel-dense: tight rows, mono-forward, zero chrome.

export const SIGNALS: Signal[] = [
  {
    id: 'SIG-00241',
    t: 'now',
    priority: 'p0',
    kind: 'CYCLE',
    source: 'MilMove',
    lane: 'Campbell → JBLM',
    laneNoun: { kind: 'base', id: 'campbell' },
    headline: 'Fort Campbell enters 120-day PCS cycle window',
    body: '~480 families with orders in the window. 38 of them match our ICP (full-pack, CONUS, >2,000 lbs). Six are already in our pipeline.',
    actor: 'MilMove cycle calendar',
    age: '0:04',
    linked: [
      { label: 'SSgt. M. Alvarez', noun: { kind: 'person', id: 'ssgt-marcus-alvarez' } },
      { label: 'SPC R. Holt' },
      { label: '36 more' },
    ],
    action: 'Trigger outreach · PCS cycle flow',
  },
  {
    id: 'SIG-00240',
    t: 'now',
    priority: 'p0',
    kind: 'COMPETITOR',
    source: 'LinkedIn',
    lane: 'Corp · ATL',
    headline: 'Weichert posted "Director, Corporate Mobility ATL" · 3 days ago',
    body: 'They lost two reps in the last 60 days in that pod. MELS will feel the continuity gap on their side. Reason to reinforce our named-dispatcher story in the BAFO.',
    actor: 'LinkedIn · public posting',
    age: '0:11',
    linked: [{ label: 'MELS Corporate Mobility', noun: { kind: 'account', id: 'acc-1188' } }],
    action: 'Flag to BAFO draft',
  },
  {
    id: 'SIG-00238',
    priority: 'p1',
    kind: 'SIGNAL',
    source: 'Email opens',
    lane: 'Rucker → Wainwright',
    laneNoun: { kind: 'base', id: 'rucker' },
    headline: 'CW3 Diane Park — 4 opens on "Alaska PCS checklist"',
    body: 'Opens at 06:12, 06:18, 22:40, 22:51 yesterday. Pattern reads as: forwarding to spouse in the evening. She is shopping the decision, not the rate.',
    actor: 'Transactional email · tracking',
    age: '0:22',
    linked: [{ label: 'CW3 Diane Park', noun: { kind: 'person', id: 'cw3-diane-park' } }],
    action: 'Add to Today · tomorrow',
  },
  {
    id: 'SIG-00235',
    priority: 'p1',
    kind: 'SPOUSE',
    source: 'Facebook group',
    lane: 'Campbell spouses',
    headline: 'Three horror stories posted to "Campbell PCS spouses" this week',
    body: 'Two name a competitor directly; one is generic. Three replies each. This is why Rachel Alvarez is nervous. A quiet, by-name callback lands differently this week than it did last week.',
    actor: 'FB group · public · monitored weekly',
    age: '1h',
    linked: [
      { label: 'Rachel Alvarez' },
      { label: 'SSgt. M. Alvarez', noun: { kind: 'person', id: 'ssgt-marcus-alvarez' } },
    ],
    action: 'Brief rep before callback',
  },
  {
    id: 'SIG-00231',
    priority: 'p1',
    kind: 'GSA',
    source: 'SAM.gov',
    lane: 'DOE · FY26',
    headline: 'New task order · DOE Oak Ridge civilian relocations · RFP drops Mon',
    body: 'Estimated $4–6M over 18 months. Teresa Hadley chairs the technical eval. We have a relationship there but the regional director M. Thibault does not know us.',
    actor: 'SAM.gov · daily poll',
    age: '3h',
    linked: [{ label: 'Atlas Federal' }, { label: 'Teresa Hadley' }],
    action: 'Queue intro to Thibault',
  },
  {
    id: 'SIG-00229',
    priority: 'p2',
    kind: 'CYCLE',
    source: 'SDDC',
    lane: 'Fort Liberty',
    headline: 'Liberty cycle sustaining · no uptick, no fall-off',
    body: 'Flat against trailing 8-week median. Not news, which is itself news — we should not be expecting it to carry inflow in July.',
    actor: 'SDDC publication · weekly',
    age: '5h',
    linked: [{ label: 'DOD-SE pod' }],
  },
  {
    id: 'SIG-00225',
    priority: 'p2',
    kind: 'COMPETITOR',
    source: 'Press release',
    lane: 'Corp',
    headline: 'Graebel announces price freeze for 2026 corporate contracts',
    body: 'They are fighting on price because their service is not winning deals. Our narrative unchanged: we sell accountability. Do not match on line-haul unless a named contact asks.',
    actor: 'Graebel newsroom',
    age: '1d',
    linked: [],
  },
  {
    id: 'SIG-00221',
    priority: 'p2',
    kind: 'PARTNER',
    source: 'Ops',
    lane: 'ATL → SEA',
    headline: 'Northbound partner gap · ATL → SEA closed next month',
    body: 'New partner (Columbia Van Lines) onboards May 12. We can stop hedging on this lane in quotes after then. Until then, the honest line stays: "known partner gap, mitigation is direct dispatch from our SEA hub."',
    actor: 'Partner Ops · N. Fogerty',
    age: '1d',
    linked: [
      { label: 'MELS Corporate Mobility', noun: { kind: 'account', id: 'acc-1188' } },
      { label: 'Lt. Col. Oduya' },
    ],
  },
];

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
