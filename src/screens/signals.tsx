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
    id: 'SIG-00241', t: 'now', priority: 'p0',
    kind: 'CYCLE', source: 'MilMove',
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
    id: 'SIG-00240', t: 'now', priority: 'p0',
    kind: 'COMPETITOR', source: 'LinkedIn',
    lane: 'Corp · ATL',
    headline: 'Weichert posted "Director, Corporate Mobility ATL" · 3 days ago',
    body: 'They lost two reps in the last 60 days in that pod. MELS will feel the continuity gap on their side. Reason to reinforce our named-dispatcher story in the BAFO.',
    actor: 'LinkedIn · public posting',
    age: '0:11',
    linked: [
      { label: 'MELS Corporate Mobility', noun: { kind: 'account', id: 'acc-1188' } },
    ],
    action: 'Flag to BAFO draft',
  },
  {
    id: 'SIG-00238', priority: 'p1',
    kind: 'SIGNAL', source: 'Email opens',
    lane: 'Rucker → Wainwright',
    laneNoun: { kind: 'base', id: 'rucker' },
    headline: 'CW3 Diane Park — 4 opens on "Alaska PCS checklist"',
    body: 'Opens at 06:12, 06:18, 22:40, 22:51 yesterday. Pattern reads as: forwarding to spouse in the evening. She is shopping the decision, not the rate.',
    actor: 'Transactional email · tracking',
    age: '0:22',
    linked: [
      { label: 'CW3 Diane Park', noun: { kind: 'person', id: 'cw3-diane-park' } },
    ],
    action: 'Add to Today · tomorrow',
  },
  {
    id: 'SIG-00235', priority: 'p1',
    kind: 'SPOUSE', source: 'Facebook group',
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
    id: 'SIG-00231', priority: 'p1',
    kind: 'GSA', source: 'SAM.gov',
    lane: 'DOE · FY26',
    headline: 'New task order · DOE Oak Ridge civilian relocations · RFP drops Mon',
    body: 'Estimated $4–6M over 18 months. Teresa Hadley chairs the technical eval. We have a relationship there but the regional director M. Thibault does not know us.',
    actor: 'SAM.gov · daily poll',
    age: '3h',
    linked: [
      { label: 'Atlas Federal' },
      { label: 'Teresa Hadley' },
    ],
    action: 'Queue intro to Thibault',
  },
  {
    id: 'SIG-00229', priority: 'p2',
    kind: 'CYCLE', source: 'SDDC',
    lane: 'Fort Liberty',
    headline: 'Liberty cycle sustaining · no uptick, no fall-off',
    body: 'Flat against trailing 8-week median. Not news, which is itself news — we should not be expecting it to carry inflow in July.',
    actor: 'SDDC publication · weekly',
    age: '5h',
    linked: [
      { label: 'DOD-SE pod' },
    ],
  },
  {
    id: 'SIG-00225', priority: 'p2',
    kind: 'COMPETITOR', source: 'Press release',
    lane: 'Corp',
    headline: 'Graebel announces price freeze for 2026 corporate contracts',
    body: 'They are fighting on price because their service is not winning deals. Our narrative unchanged: we sell accountability. Do not match on line-haul unless a named contact asks.',
    actor: 'Graebel newsroom',
    age: '1d',
    linked: [],
  },
  {
    id: 'SIG-00221', priority: 'p2',
    kind: 'PARTNER', source: 'Ops',
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
  CYCLE: { c: 'olive',  lbl: 'PCS-CYCLE' },
  COMPETITOR: { c: 'accent', lbl: 'COMPETITOR' },
  SIGNAL: { c: 'info',  lbl: 'BUYING-SIGNAL' },
  SPOUSE: { c: 'info',  lbl: 'SPOUSE-GROUP' },
  GSA: { c: 'olive', lbl: 'GSA-RFP' },
  PARTNER: { c: 'accent', lbl: 'PARTNER-OPS' },
};

export function Signals() {
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [selected, setSelected] = React.useState<string>(SIGNALS[0].id);

  const list = filter === 'all' ? SIGNALS
    : filter === 'p0' ? SIGNALS.filter(s => s.priority === 'p0')
    : SIGNALS.filter(s => s.kind === filter);

  const cur = SIGNALS.find(s => s.id === selected) || SIGNALS[0];

  const counts = {
    all: SIGNALS.length,
    p0: SIGNALS.filter(s => s.priority === 'p0').length,
    CYCLE: SIGNALS.filter(s => s.kind === 'CYCLE').length,
    COMPETITOR: SIGNALS.filter(s => s.kind === 'COMPETITOR').length,
    SIGNAL: SIGNALS.filter(s => s.kind === 'SIGNAL' || s.kind === 'SPOUSE').length,
    GSA: SIGNALS.filter(s => s.kind === 'GSA').length,
  };

  return (
    <div className="signals">
      <div className="sig-head">
        <div>
          <div className="eyebrow">Signals · live · 8 events today · 32 this week</div>
          <h1>Signals feed</h1>
          <div className="sub">Machine reads the world so the rep doesn't have to. Every signal links to a person, a deal, or a base — nothing floats alone.</div>
        </div>
        <div className="sig-meta">
          <PollIndicator />
        </div>
      </div>

      <div className="sig-filters">
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          All <span className="n">{counts.all}</span>
        </button>
        <button type="button" className={filter ==='p0' ? 'on p0' : 'p0'} onClick={() => setFilter('p0')}>
          P0 <span className="n">{counts.p0}</span>
        </button>
        <div className="div"></div>
        <button type="button" className={filter ==='CYCLE' ? 'on' : ''} onClick={() => setFilter('CYCLE')}>PCS cycle <span className="n">{counts.CYCLE}</span></button>
        <button type="button" className={filter ==='COMPETITOR' ? 'on' : ''} onClick={() => setFilter('COMPETITOR')}>Competitor <span className="n">{counts.COMPETITOR}</span></button>
        <button type="button" className={filter ==='SIGNAL' ? 'on' : ''} onClick={() => setFilter('SIGNAL')}>Buying signal <span className="n">{counts.SIGNAL}</span></button>
        <button type="button" className={filter ==='GSA' ? 'on' : ''} onClick={() => setFilter('GSA')}>GSA <span className="n">{counts.GSA}</span></button>
      </div>

      <div className="sig-body">
        <div className="sig-list">
          {list.map(s => {
            const k = KINDS[s.kind];
            const onKey = (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s.id); }
            };
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                aria-current={s.id === selected ? 'true' : undefined}
                aria-label={`Signal ${s.id}: ${s.headline}`}
                className={`sig-row${s.id === selected ? ' on' : ''}${s.priority === 'p0' ? ' p0' : ''}`}
                onClick={() => setSelected(s.id)}
                onKeyDown={onKey}
              >
                <div className="age">{s.age}</div>
                <div className={`kind ${k.c}`}>{k.lbl}</div>
                <div className="lane">
                  {s.laneNoun
                    ? <Noun kind={s.laneNoun.kind} id={s.laneNoun.id}>{s.lane}</Noun>
                    : s.lane}
                </div>
                <div className="line">{s.headline}</div>
                <div className="id" onClick={e => e.stopPropagation()}>
                  <Noun kind="signal" id={s.id}>{s.id}</Noun>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="sig-detail">
          <div className="sd-head">
            <div className="id"><Noun kind="signal" id={cur.id}>{cur.id}</Noun></div>
            <div className={`badge ${KINDS[cur.kind].c}`}>{KINDS[cur.kind].lbl}</div>
            {cur.priority === 'p0' && <div className="badge p0">P0</div>}
          </div>
          <h2>{cur.headline}</h2>
          <div className="sd-body">{cur.body}</div>

          <div className="sd-kv">
            <div><div className="k">Source</div><div className="v">{cur.actor}</div></div>
            <div><div className="k">Age</div><div className="v mono">{cur.age} ago</div></div>
            <div><div className="k">Lane</div><div className="v">{cur.lane}</div></div>
            <div><div className="k">Confidence</div><div className="v">{cur.priority === 'p0' ? 'High · verified' : cur.priority === 'p1' ? 'Medium · pattern' : 'Low · context'}</div></div>
          </div>

          {cur.linked && cur.linked.length > 0 && (
            <div className="sd-linked">
              <div className="k">Linked</div>
              {cur.linked.map(l => (
                l.noun
                  ? <Noun key={l.label} kind={l.noun.kind} id={l.noun.id} className="chip solid-link">{l.label}</Noun>
                  : <div key={l.label} className="chip solid-link">{l.label}</div>
              ))}
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
                if (res.ok) track({ name: 'signal.dismissed', props: { id: cur.id, requestId: res.requestId } });
              }}
            >
              <EyeOff className="ic-sm" aria-hidden="true" />Dismiss
            </button>
            <button type="button" className="btn"><BellOff className="ic-sm" aria-hidden="true" />Mute kind</button>
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const sid = fromDisplayId<SignalId>(cur.id);
                const res = await actionSignal(sid, newIdempotencyKey());
                if (res.ok) track({ name: 'signal.actioned', props: { id: cur.id, requestId: res.requestId } });
              }}
            >
              <Check className="ic-sm" aria-hidden="true" />Actioned
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
        <div className="live-row"><span className="pulse"></span>No schedules registered</div>
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

