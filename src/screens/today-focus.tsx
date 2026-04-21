import React from 'react';
import { List, Bell, Phone, MessageSquare, Clock, AlertCircle, Circle } from 'lucide-react';
import { TODAY_CARDS } from '../lib/data';
import { Noun } from '../components/nouns';
import type { TodaySort } from '../lib/types';

// Single-focus Today — one person at a time. Big card, everything else collapses.
// The "make the call" mode.

export interface TodayFocusProps {
  sort: TodaySort;
  setMode: (m: 'focus' | 'list') => void;
}

export function TodayFocus({ sort, setMode }: TodayFocusProps) {
  const cards = sort === 'stage'
    ? [...TODAY_CARDS].sort((a, b) => a.kind.localeCompare(b.kind))
    : TODAY_CARDS;

  const [idx, setIdx] = React.useState(0);
  const [called, setCalled] = React.useState<Record<string, boolean>>({});
  const cur = cards[idx];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches?.('input,textarea,select')) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(cards.length - 1, i + 1)); }
      if (e.key === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      if (e.key === 'x') { setCalled(c => ({ ...c, [cur.id]: true })); setIdx(i => Math.min(cards.length - 1, i + 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, cards.length]);

  return (
    <div className="focus">
      <div className="focus-head">
        <div className="eyebrow">Focus mode · one person at a time · ⌘⇧F to toggle</div>
        <div className="focus-progress">
          <div className="dots">
            {cards.map((c, i) => (
              <button
                type="button"
                key={c.id}
                aria-label={`Go to card ${i + 1} (${c.name})`}
                aria-current={i === idx ? 'true' : undefined}
                className={`dot${i === idx ? ' on' : ''}${called[c.id] ? ' done' : ''}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
          <div className="count">{String(idx+1).padStart(2,'0')} · {String(cards.length).padStart(2,'0')}</div>
          <button type="button" className="btn ghost" onClick={() => setMode('list')}>
            <List className="ic-sm" aria-hidden="true" />Back to queue
          </button>
        </div>
      </div>

      <div className="focus-grid">
        <div className="focus-main">
          <div className="focus-rank">
            <div className="n">{String(cur.rank).padStart(2,'0')}</div>
            <div className="of">of {cards.length}</div>
            <div className="why-rank" title={`${cur.score.lineage.model} v${cur.score.lineage.version}`}>spear-score · {cur.score.value}</div>
          </div>

          <div className="focus-who">
            <div className="who-meta">
              <span className={`tag-rank ${cur.kind === 'PCS' ? 'pcs' : cur.kind === 'CORP' ? 'corp' : 'indiv'}`}>{cur.kind}</span>
              {cur.idNoun
                ? <Noun kind={cur.idNoun.kind} id={cur.idNoun.id} className="mono-id">{cur.id}</Noun>
                : <span className="mono-id">{cur.id}</span>}
              <span>·</span>
              <span>{cur.branch}</span>
              <span>·</span>
              <span>{cur.base}</span>
            </div>
            {cur.noun
              ? <h1 className="name"><Noun kind={cur.noun.kind} id={cur.noun.id}>{cur.name}</Noun></h1>
              : <h1 className="name">{cur.name}</h1>}
            <div className="why-line">
              {cur.now && <Bell className="ic-sm v-middle mr-6 c-accent" aria-hidden="true" />}
              <em>{cur.why}</em>
            </div>
            <div className="ctx">{cur.context}</div>
          </div>

          <div className="script">
            <div className="script-head">Script · what to open with</div>
            <div className="script-body">
              "Hey Rachel — it's Marcus from Spear. I wanted to call a few minutes early because I know the 09:30 window was when you said you'd have the kids settled. Is now still okay?"
            </div>
            <div className="script-note">Then: name the three things from the Facebook thread without mentioning the thread. Acknowledge the nerves, don't sell past them.</div>
          </div>

          <div className="focus-actions">
            <button
              type="button"
              className="btn primary lg"
              onClick={() => { setCalled(c => ({ ...c, [cur.id]: true })); setIdx(i => Math.min(cards.length - 1, i + 1)); }}
            >
              <Phone className="ic-sm" aria-hidden="true" />Start call
              <span className="kbd-trail">X</span>
            </button>
            <button type="button" className="btn lg"><MessageSquare className="ic-sm" aria-hidden="true" />Message instead</button>
            <button type="button" className="btn lg ghost"><Clock className="ic-sm" aria-hidden="true" />Snooze 2h</button>
          </div>
        </div>

        <aside className="focus-side">
          <div className="fs-card">
            <div className="k">What's on the line</div>
            {cur.meta.map((m, i) => (
              <div key={i} className={`fs-row${m.accent ? ' accent' : ''}`}>
                {m.accent ? <AlertCircle className="ic-sm" aria-hidden="true" /> : <Circle className="ic-sm" aria-hidden="true" />}
                <span>{m.t}</span>
              </div>
            ))}
          </div>

          <div className="fs-card">
            <div className="k">Last 3 touches</div>
            <div className="fs-touch"><span className="t">Apr 17 · 16:22</span>You · <em>quote sent, $2,140</em></div>
            <div className="fs-touch"><span className="t">Apr 15 · 11:08</span>Rachel · <em>"can we do pack on the 8th?"</em></div>
            <div className="fs-touch"><span className="t">Apr 14 · 09:40</span>You · <em>30-min discovery call</em></div>
          </div>

          <div className="fs-card">
            <div className="k">After this call</div>
            <div className="fs-next">
              {cards.slice(idx + 1, idx + 4).map((c, i) => (
                <button type="button" key={c.id} className="fs-next-row" onClick={() => setIdx(idx + 1 + i)}>
                  <span className="rank">{String(c.rank).padStart(2,'0')}</span>
                  <span className="name">{c.name}</span>
                  {c.now && <span className="now-tag">now</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="fs-kbd">
            <div className="k">Keyboard</div>
            <div><kbd>J</kbd> <kbd>K</kbd> <span>next · prev</span></div>
            <div><kbd>X</kbd> <span>mark called · advance</span></div>
            <div><kbd>⌘⇧F</kbd> <span>exit focus</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
