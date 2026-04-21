import React from 'react';
import { Focus, Bell, Phone, MessageSquare, Clock, Circle, AlertCircle } from 'lucide-react';
import { TODAY_CARDS, LEADERBOARD } from '../lib/data';
import { Noun } from '../components/nouns';
import { TodayFocus } from './today-focus';
import { formatMoneyShort } from '../lib/money';
import { readString, writeString } from '../app/state';
import { promiseStore } from '../app/runtime';
import { relativeTime } from '../lib/time';
import type { TodaySort } from '../lib/types';
import type { DurablePromise } from '../domain/promises';
import { topContributors, type DerivedValue } from '../ontology/lineage';

// Hover tooltip showing the top three contributors to a derived score.
function lineageTitle(d: DerivedValue<number>): string {
  const tops = topContributors(d, 3)
    .map((c) => `${(c.weight * 100).toFixed(0)}% · ${c.label}`)
    .join('\n');
  return `${d.lineage.model} v${d.lineage.version}\n${tops}`;
}

// Spear CRM — Today + Pond screens

export interface TodayProps {
  sort: TodaySort;
}

type Mode = 'focus' | 'list';

export function Today({ sort }: TodayProps) {
  const [mode, setMode] = React.useState<Mode>(() => {
    const v = readString('todayMode');
    return v === 'focus' || v === 'list' ? v : 'list';
  });
  React.useEffect(() => { writeString('todayMode', mode); }, [mode]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches?.('input,textarea,select')) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setMode(m => m === 'focus' ? 'list' : 'focus');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (mode === 'focus') return <TodayFocus sort={sort} setMode={setMode} />;
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Sort: priority (default) or by stage grouping
  const cards = sort === 'stage'
    ? [...TODAY_CARDS].sort((a, b) => a.kind.localeCompare(b.kind))
    : TODAY_CARDS;

  return (
    <div className="today">
      <div className="today-left">
        <div className="today-hero fade-up">
          <div>
            <div className="greet">{greet} · Tue Apr 21 · 08:47 CDT</div>
            <h1>
              Five people are waiting on you.{' '}
              <em>One has a clock.</em>
            </h1>
          </div>
          <div className="hero-right">
            <button type="button" className="btn mb-10" onClick={() => setMode('focus')}>
              <Focus className="ic-sm" aria-hidden="true" />Enter focus mode<span className="kbd-trail">⌘⇧F</span>
            </button>
            <div className="hero-stat">
              <div className="s"><div className="n">5</div><div className="l">In queue</div></div>
              <div className="s"><div className="n">3</div><div className="l">Promises due</div></div>
              <div className="s"><div className="n">$2.4M</div><div className="l">At stake</div></div>
            </div>
          </div>
        </div>

        <div className="today-section-head">
          <h3>Who needs you now <span className="count">· ranked by time-sensitivity, not score</span></h3>
          <div className="why">A Spear rep makes <strong className="sans-normal">5 real calls a day.</strong> These are yours.</div>
        </div>

        <div className="today-list">
          {cards.map(c => (
            <div key={c.id} className={`today-card${c.now ? ' now' : ''} fade-up`}>
              <div className="rank">
                <div className="n">{String(c.rank).padStart(2, '0')}</div>
                <div className="score" title={lineageTitle(c.score)}>{c.score.value} · spear-score</div>
              </div>
              <div className="who">
                <div className="name-row">
                  {c.noun
                    ? <div className="name"><Noun kind={c.noun.kind} id={c.noun.id}>{c.name}</Noun></div>
                    : <div className="name">{c.name}</div>}
                  <span className={`tag-rank ${c.kind === 'PCS' ? 'pcs' : c.kind === 'CORP' ? 'corp' : 'indiv'}`}>{c.kind}</span>
                  <span className="sub-id">
                    {c.idNoun
                      ? <Noun kind={c.idNoun.kind} id={c.idNoun.id}>{c.id}</Noun>
                      : c.id} · {c.branch} · {c.base}
                  </span>
                </div>
                <div className={`mono-body ${c.now ? 'c-accent' : 'c-muted'}`}>
                  {c.now && <Bell className="ic-sm v-middle mr-4" aria-hidden="true" />}{c.why}
                </div>
                <div className="context">{c.context}</div>
                <div className="meta-row">
                  {c.meta.map((m, i) => (
                    <span key={i} className={`m${m.accent ? ' accent' : ''}`}>
                      {m.accent
                        ? <Clock className="ic-sm" aria-hidden="true" />
                        : <Circle className="ic-sm op-50" aria-hidden="true" />}
                      {m.t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="actions">
                <button type="button" className={`btn ${c.now ? 'primary' : ''}`}>
                  <Phone className="ic-sm" aria-hidden="true" />
                  {c.kind === 'CORP' || c.kind === 'GSA' ? 'Start BAFO draft' : 'Start call'}
                </button>
                <button type="button" className="btn ghost"><MessageSquare className="ic-sm" aria-hidden="true" />Message</button>
                <div className="snooze">Snooze · 2h</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="today-right">
        <div className="queue-head">
          <div className="eyebrow">Queue principles</div>
          <div className="q-title">Make five real calls. Close two loops.</div>
          <div className="q-sub">The queue ranks by <strong className="sans-normal">what you promised</strong>, not by deal value. We keep score differently here.</div>
        </div>

        <div className="focus-timer">
          <div className="lbl">Focus block · in progress</div>
          <div className="time">00:42:18</div>
          <div className="bar"><div className="fill"></div></div>
          <div className="bar-label"><span>Deep work</span><span>48 min left</span></div>
        </div>

        <PromiseList />
      </aside>
    </div>
  );
}

function PromiseList() {
  const [promises, setPromises] = React.useState<readonly DurablePromise[]>(promiseStore.list());
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());

  React.useEffect(() => promiseStore.subscribe(setPromises), []);
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="promise-list">
      <div className="lbl">Promises on the line</div>
      {promises.length === 0 && <div className="promise-empty">No active promises.</div>}
      {promises.map((p) => {
        const cls = p.status === 'escalated' ? 'overdue'
          : p.status === 'missed' ? 'overdue'
          : new Date(p.dueAt.iso).getTime() - nowMs < 24 * 60 * 60 * 1000 ? 'soon'
          : '';
        return (
          <div key={p.id} className={`promise ${cls}`}>
            <div className="dot"></div>
            <div>
              <div className="body">{p.text}</div>
              <div className="meta">
                {p.status === 'pending' && `Due ${relativeTime(p.dueAt)}`}
                {p.status === 'missed' && (<><AlertCircle className="ic-sm v-middle mr-4" aria-hidden="true" />Missed · escalating</>)}
                {p.status === 'escalated' && 'Escalated to manager'}
                {p.status === 'kept' && 'Kept'}
              </div>
            </div>
          </div>
        );
      })}
    </div>);
}

export function Pond() {
  // Week-over-week bar heights (12 weeks)
  const bars = [38, 42, 45, 50, 48, 52, 56, 61, 58, 64, 70, 74];
  return (
    <div className="pond">
      <div className="hero">
        <div>
          <div className="eyebrow">Pond health · Week 16 · Team SE</div>
          <h1>The pond is <em>fuller this month</em>, but 41% of the inflow came from two bases that rotate out in July.</h1>
        </div>
        <div className="pond-time">As of Tue Apr 21 · 08:47 CDT · Live</div>
      </div>

      <div className="pond-grid">
        <div className="pond-card pond-span-6">
          <div className="eyebrow">Read of the week</div>
          <div className="headline">Inbound from <em>Fort Campbell</em> and <em>Fort Liberty</em> is doing the heavy lifting right now.</div>
          <div className="body">Combined, those two posts generated 41% of qualified leads this month. Campbell has a PCS cycle peaking in June; Liberty is steady. When the cycle ends, we will feel it in August — we should have a plan now, not then.</div>
          <div className="foot">Source · MilMove cycle data + inbound form · confidence: high</div>
        </div>
        <div className="pond-card pond-span-3">
          <div className="eyebrow">Qualified leads · wk</div>
          <div className="big">74<em> ↑</em></div>
          <div className="body body-sm-muted">Up from 58 last week. Four-week median: 56.</div>
          <div className="foot">+28% vs. 4-wk median</div>
        </div>
        <div className="pond-card pond-span-3">
          <div className="eyebrow">Conversion · quote → signed</div>
          <div className="big">34<em>%</em></div>
          <div className="body body-sm-muted">Our target is 40%. We are losing ground on OCONUS quotes; coverage gap on the AK port is the usual reason.</div>
          <div className="foot">−6 pts vs. Q4</div>
        </div>

        <div className="pond-card pond-span-8">
          <div className="eyebrow">Inflow · last 12 weeks</div>
          <div className="bar-chart">
            {bars.map((h, i) => <div key={i} className={`bar ${i >= bars.length-2 ? 'hot' : ''}`} style={{height: `${h}%`}} title={`Wk ${i+5}: ${h} leads`}></div>)}
          </div>
          <div className="bar-chart-labels">
            {bars.map((_, i) => <div key={i} className="lb">W{5+i}</div>)}
          </div>
          <div className="body body-sm-muted">Two bars highlighted are this week and last. Growth is real, and it's concentrated — not diversified.</div>
        </div>

        <div className="pond-card pond-span-4">
          <div className="eyebrow">Rep leaderboard · MTD</div>
          <div className="mt-neg-2">
            {LEADERBOARD.map((l, i) => (
              <div key={i} className="leader-row">
                <div className="pos">{l.pos}</div>
                <div>
                  <div className="n">{l.n}</div>
                  <div className="pod">{l.pod}</div>
                </div>
                <div></div>
                <div className="val">{formatMoneyShort(l.val)}</div>
                <div className={`delta ${l.cls}`}>{l.delta}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pond-card pond-span-6">
          <div className="eyebrow">Where we are losing</div>
          <div className="headline">OCONUS quotes — we lose <em>61% of them</em> when our partner network has a port gap.</div>
          <div className="body">Alaska, Guam, and Ramstein port-of-entry. The candidates for those lanes are the last to get a callback because reps (correctly) feel uncertain. A scripted honesty line would help: <em>"We have a known partner gap for this lane; here's what we're doing about it."</em></div>
          <div className="foot">Pattern detected in 9 of the last 15 OCONUS losses</div>
        </div>
        <div className="pond-card pond-span-6">
          <div className="eyebrow">Where we are winning</div>
          <div className="headline">Partial-pack PCS under <em>3,000 lbs</em> — we close these 54% of the time.</div>
          <div className="body">Crew experience on short-weight moves is the reason. When a spouse talks to a previous customer, they hear words like "careful" and "on time." Not "delighted," which is the right thing not to hear.</div>
          <div className="foot">n = 142 moves · Jan–Apr</div>
        </div>
      </div>
    </div>
  );
}
