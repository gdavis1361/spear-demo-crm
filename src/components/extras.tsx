import React from 'react';
import { MessageSquare, Eye, X, Check, FileText } from 'lucide-react';
import { LEADERBOARD } from '../lib/data';
import { formatMoneyShort } from '../lib/money';
import { HonestNoteSchema } from '../lib/schemas';
import { track } from '../app/telemetry';
import { MANAGER_TODAY } from './extras.data';
// Co-located CSS for this chunk. Vite lazy-splits it alongside `extras-*.js`
// since `extras.tsx` is a React.lazy entry point in `App.tsx`. Users in
// the default `rep` role never download these styles on first paint.
import './extras.css';

// Manager-role screens — team queue, team pond. Also the "honest note" drafter.

export function ManagerToday() {
  return (
    <div className="mgr-today">
      <div className="today-hero fade-up">
        <div>
          <div className="greet">Team SE · Tue Apr 21 · 08:47 CDT</div>
          <h1>
            Two reps are at risk today. <em>One promise is overdue.</em>
          </h1>
        </div>
        <div className="hero-right">
          <div className="hero-stat">
            <div className="s">
              <div className="n">6</div>
              <div className="l">On deck</div>
            </div>
            <div className="s">
              <div className="n">2</div>
              <div className="l">At risk</div>
            </div>
            <div className="s">
              <div className="n">1</div>
              <div className="l">Overdue</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mgr-section-head">
        <h3>
          Team roster <span className="count">· sorted by risk, then by pod</span>
        </h3>
        <div className="why">
          The manager view is not a leaderboard. It is a{' '}
          <strong className="sans-normal">"is anyone stuck?"</strong> view. Red means intervene.
        </div>
      </div>

      <div className="mgr-list">
        {[...MANAGER_TODAY]
          .sort((a, b) => (b.risk === 'high' ? 1 : 0) - (a.risk === 'high' ? 1 : 0))
          .map((r) => (
            <div key={r.rep} className={`mgr-row risk-${r.risk}`}>
              <div className="mgr-rep">
                <div className="ini">
                  {r.rep
                    .split(' ')
                    .map((x) => x[0])
                    .join('')
                    .replace('.', '')}
                </div>
                <div>
                  <div className="name">{r.rep}</div>
                  <div className="pod">{r.pod}</div>
                </div>
              </div>
              <div className="mgr-state">
                <div className="status">
                  {r.status === 'in-focus' && <span className="st-dot in-focus"></span>}
                  {r.status === 'queue' && <span className="st-dot queue"></span>}
                  {r.status === 'at-risk' && <span className="st-dot risk"></span>}
                  {r.state}
                </div>
                <div className="now">
                  Now · <em>{r.now}</em>
                </div>
              </div>
              <div className="mgr-promise">
                <div className="k">Promise watch</div>
                <div className={`v${r.promise.includes('overdue') ? ' overdue' : ''}`}>
                  {r.promise}
                </div>
              </div>
              <div className="mgr-actions">
                {r.risk === 'high' ? (
                  <button type="button" className="btn primary">
                    <MessageSquare className="ic-sm" aria-hidden="true" />
                    Check in
                  </button>
                ) : (
                  <button type="button" className="btn">
                    <Eye className="ic-sm" aria-hidden="true" />
                    Open queue
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>

      <div className="mgr-note">
        <div className="eyebrow">Why this view looks different</div>
        <div className="body">
          A rep's Today answers <em>"who should I call?"</em>. A manager's Today answers{' '}
          <em>"is anyone stuck?"</em> — those are different questions and they deserve different
          screens. We resisted making this a dashboard with KPIs. The KPIs are on Pond.
        </div>
      </div>
    </div>
  );
}

export function ManagerPond() {
  return (
    <div className="pond">
      <div className="hero">
        <div>
          <div className="eyebrow">Pond health · Team SE · Week 16 · Mgr view</div>
          <h1>
            Team is <em>carrying the pod</em> — but the pod is carrying <em>one person</em>.
          </h1>
        </div>
        <div className="pond-time">As of Tue Apr 21 · 08:47 CDT · Live</div>
      </div>

      <div className="pond-grid">
        <div className="pond-card pond-span-8">
          <div className="eyebrow">Concentration risk · top contributor</div>
          <div className="headline">
            M. Hall is producing <em>48% of pod MRR</em>. If she takes PTO the week of May 06, we
            have a problem.
          </div>
          <div className="body">
            Two deals in her pipeline (MELS · Nordlight) are irreplaceable by another rep at her
            current stage. We should pair K. Okonkwo on MELS this week — not to shadow, but to build
            a real second relationship with Rene Odita.
          </div>
          <div className="foot">Detected pattern · 3 of last 4 quarters</div>
        </div>
        <div className="pond-card pond-span-4">
          <div className="eyebrow">Rep health index</div>
          <div className="big">
            4 / 6<em> healthy</em>
          </div>
          <div className="body body-sm-muted">
            Brennan · no activity 2h+. Hemming · queue stale. Both get a slack from me this morning,
            not a ticket.
          </div>
          <div className="foot">Signals · last 24h</div>
        </div>

        <div className="pond-card pond-span-6">
          <div className="eyebrow">Team velocity</div>
          <div className="headline">
            First-touch time is <em>down to 28 minutes</em> · median, last 30 days.
          </div>
          <div className="body">
            Two months ago it was 54. The focus-mode rollout closed the gap. We should not celebrate
            this in a deck — we should make sure it does not regress when we add quote-builder
            training next month.
          </div>
          <div className="foot">Source · touch timestamps · n=214</div>
        </div>
        <div className="pond-card pond-span-6">
          <div className="eyebrow">Where the pod is losing</div>
          <div className="headline">
            OCONUS partial-pack · <em>14% win rate</em>. Corporate-adjacent SMB is worse.
          </div>
          <div className="body">
            This is a training gap, not a product gap. Reps are discounting at the first sign of
            resistance. We'll pair D. Laurent with Brennan on two SMB deals this week to model the
            honest-price conversation.
          </div>
          <div className="foot">Pattern confirmed in 9 of 11 losses</div>
        </div>

        <div className="pond-card pond-span-12">
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
      </div>
    </div>
  );
}

// ============ Honest-note drafter — Quote builder ============

const HONEST_TEMPLATES = [
  {
    id: 'straight',
    lbl: 'Straight',
    text: `We don't own the trucks. We coordinate the people who do, and we're accountable for the outcome. This quote covers Jun 08 pack and a 4–5 day line-haul, with delivery window Jun 13–15 at JBLM. If anything slips, your dispatcher is Marcus Hall — he reads and responds himself.`,
  },
  {
    id: 'partner-gap',
    lbl: 'Partner gap',
    text: `Heads up on one thing: our partner network has a known gap on the Seattle port-of-entry route right now. We have a mitigation plan — direct dispatch from our Tacoma hub — and we've run this route that way eight times this quarter without an issue. We'd rather tell you now than have you find out at delivery.`,
  },
  {
    id: 'price-difference',
    lbl: 'Price difference',
    text: `You will see other quotes come in lower than this one. Two things to know: our number includes full-value protection and a named dispatcher, neither of which the cheapest quote will include. If someone comes back at 20% less, that 20% is the claims desk and it shows up at delivery, not at signing.`,
  },
];

export interface HonestDraftProps {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export function HonestDraft({ open, onClose, onInsert }: HonestDraftProps) {
  const [tmpl, setTmpl] = React.useState('straight');
  const [text, setText] = React.useState(HONEST_TEMPLATES[0].text);
  React.useEffect(() => {
    const found = HONEST_TEMPLATES.find((t) => t.id === tmpl);
    if (found) setText(found.text);
  }, [tmpl]);
  if (!open) return null;

  const wc = text.trim().split(/\s+/).length;

  return (
    <div className="draft-overlay" onClick={onClose} role="presentation">
      <div
        className="draft"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-title"
      >
        <div className="draft-head">
          <div>
            <div className="eyebrow">Honest note · drafter</div>
            <h3 id="draft-title">What we tell Rachel Alvarez, in our own words</h3>
            <div className="draft-sub">
              This is the paragraph the shipper sees before the price. It is the paragraph the rep
              reads out loud on the call. It is the thing we do not outsource to marketing.
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="ic" aria-hidden="true" />
          </button>
        </div>

        <div className="draft-body">
          <div className="draft-left">
            <div className="draft-k">Starting point</div>
            <div className="draft-tmpls">
              {HONEST_TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  aria-pressed={tmpl === t.id}
                  className={`draft-tmpl${tmpl === t.id ? ' on' : ''}`}
                  onClick={() => setTmpl(t.id)}
                >
                  <div className="lbl">{t.lbl}</div>
                  <div className="pv">{t.text.slice(0, 64)}…</div>
                </button>
              ))}
            </div>

            <div className="draft-k mt-18">Rules we hold ourselves to</div>
            <ul className="draft-rules">
              <li>No exclamation points.</li>
              <li>No "excited," "thrilled," "delighted."</li>
              <li>Name one dispatcher. Name one failure mode.</li>
              <li>Sentence-case headings. Periods at the end.</li>
              <li>If we can't commit to a date, we say that, not "as soon as possible."</li>
            </ul>
          </div>

          <div className="draft-right">
            <div className="draft-editor-head">
              <div className="draft-k">Your paragraph</div>
              <div className="draft-counts">
                <span>
                  <strong>{wc}</strong> words
                </span>
                <span>·</span>
                <span>{text.length} chars</span>
              </div>
            </div>
            <textarea
              className="draft-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="draft-checks">
              <div className={`chk ${!/!/.test(text) ? 'ok' : 'fail'}`}>
                {!/!/.test(text) ? (
                  <Check className="ic-sm" aria-hidden="true" />
                ) : (
                  <X className="ic-sm" aria-hidden="true" />
                )}
                <span>No exclamation points</span>
              </div>
              <div className={`chk ${!/(excited|thrilled|delighted)/i.test(text) ? 'ok' : 'fail'}`}>
                {!/(excited|thrilled|delighted)/i.test(text) ? (
                  <Check className="ic-sm" aria-hidden="true" />
                ) : (
                  <X className="ic-sm" aria-hidden="true" />
                )}
                <span>No sales adjectives</span>
              </div>
              <div className={`chk ${/dispatcher/i.test(text) ? 'ok' : 'fail'}`}>
                {/dispatcher/i.test(text) ? (
                  <Check className="ic-sm" aria-hidden="true" />
                ) : (
                  <X className="ic-sm" aria-hidden="true" />
                )}
                <span>Names a dispatcher</span>
              </div>
              <div className={`chk ${wc >= 30 && wc <= 80 ? 'ok' : 'fail'}`}>
                {wc >= 30 && wc <= 80 ? (
                  <Check className="ic-sm" aria-hidden="true" />
                ) : (
                  <X className="ic-sm" aria-hidden="true" />
                )}
                <span>30–80 words ({wc})</span>
              </div>
            </div>
          </div>
        </div>

        <div className="draft-foot">
          <div className="draft-foot-note">
            The paragraph updates in the live shipper preview the moment you insert it.
          </div>
          <div className="draft-foot-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const parsed = HonestNoteSchema.safeParse({ text });
                if (!parsed.success) {
                  console.warn('[honest-draft] validation failed', parsed.error.issues);
                  return;
                }
                const checksPassed = [
                  !/!/.test(text),
                  !/(excited|thrilled|delighted)/i.test(text),
                  /dispatcher/i.test(text),
                  wc >= 30 && wc <= 80,
                ].filter(Boolean).length;
                track({
                  name: 'honest_draft.inserted',
                  props: { template: tmpl, wordCount: wc, checksPassed },
                });
                onInsert(parsed.data.text);
                onClose();
              }}
            >
              <Check className="ic-sm" aria-hidden="true" />
              Insert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Account tabs ============

const DEALS_LIST = [
  {
    id: 'ACC-1188 / MSA-2025-041',
    title: 'Annual MSA · 2026 renewal',
    stage: 'BAFO',
    value: '$740K',
    close: 'Wed',
    cls: 'hot',
    note: 'Line-haul narrative for 5 ATL lanes is the unblocker.',
  },
  {
    id: 'LD-40021',
    title: 'Maj. L. Okafor · Atlanta → Benning',
    stage: 'Won',
    value: '$3,220',
    close: 'Apr 08 · signed',
    cls: 'won',
    note: 'Claims on humidor closed 36h — Katherine cited in QBR.',
  },
  {
    id: 'LD-39740',
    title: 'Eng. VP relocation · ATL → Boulder',
    stage: 'Won',
    value: '$12,410',
    close: 'Feb 22 · signed',
    cls: 'won',
    note: "Executive white-glove. Shipper = K. Ruiz's peer.",
  },
  {
    id: 'LD-39188',
    title: '4-family Q1 batch · ATL metro',
    stage: 'Won',
    value: '$22,900',
    close: 'Jan 18 · signed',
    cls: 'won',
    note: 'MELS trialled us against Weichert · we won 3/4.',
  },
  {
    id: 'LD-38012',
    title: 'Pilot · 2 relos',
    stage: 'Won',
    value: '$6,400',
    close: 'Oct 2024',
    cls: 'won',
    note: 'First deals. Our foot in the door.',
  },
];
const DOCS_LIST = [
  { n: 'MSA-2025-041 · draft v3.pdf', by: 'M. Hall · today 06:14', size: '142 KB', tag: 'MSA' },
  {
    n: 'Weichert proposal · fwd Apr 20.pdf',
    by: 'K. Ruiz · Apr 20 · 18:04',
    size: '1.1 MB',
    tag: 'COMPETITOR',
  },
  {
    n: 'QBR deck · Atlanta HQ · Apr 14.pptx',
    by: 'M. Hall · Apr 14 · 17:40',
    size: '3.8 MB',
    tag: 'QBR',
  },
  { n: 'Claims case · Oduya · Mar 06.pdf', by: 'Claims · Mar 06', size: '88 KB', tag: 'CLAIM' },
  {
    n: 'Line-haul rate card · ATL lanes.xlsx',
    by: 'S. Brennan · Apr 19',
    size: '64 KB',
    tag: 'PRICING',
  },
  { n: 'Partner coverage map · Q2.pdf', by: 'N. Fogerty · Apr 12', size: '240 KB', tag: 'OPS' },
];
const ACTIVITY_LIST = [
  {
    t: '08:14 CDT',
    k: 'Message',
    who: 'M. Hall',
    body: "Reading now. I'll have a numbered response…",
    tag: 'outbound',
  },
  {
    t: '08:09 CDT',
    k: 'Message',
    who: 'K. Ruiz',
    body: "Forwarding Weichert's proposal. Line-haul pricing…",
    tag: 'inbound',
  },
  {
    t: 'Mon 17:40',
    k: 'Signal',
    who: 'system',
    body: 'Katherine opened "MSA draft v2" three times in 18 min — pattern: reviewing with someone.',
    tag: 'signal',
  },
  {
    t: 'Mon 14:22',
    k: 'File',
    who: 'M. Hall',
    body: 'Uploaded MSA-2025-041 draft v3.pdf',
    tag: 'file',
  },
  {
    t: 'Apr 17',
    k: 'Meeting',
    who: 'M. Hall',
    body: 'Internal · BAFO strategy w/ S. Brennan (45 min)',
    tag: 'internal',
  },
  {
    t: 'Apr 14',
    k: 'Meeting',
    who: 'K. Ruiz + 2',
    body: 'Quarterly business review · Atlanta HQ (90 min)',
    tag: 'meeting',
  },
  {
    t: 'Mar 06',
    k: 'Claim',
    who: 'Claims team',
    body: 'Oduya claim · $1,200 humidor · paid in 36h',
    tag: 'claim',
  },
];

export function AccountDeals() {
  return (
    <section>
      <h3 className="acct-section-title">
        All deals with MELS <span className="muted">· 5 total · $785K lifetime</span>
      </h3>
      <div className="adl">
        {DEALS_LIST.map((d) => (
          <div key={d.id} className={`adl-row ${d.cls}`}>
            <div className="adl-id">{d.id}</div>
            <div className="adl-main">
              <div className="adl-title">{d.title}</div>
              <div className="adl-note">{d.note}</div>
            </div>
            <div className={`adl-stage ${d.cls}`}>{d.stage}</div>
            <div className="adl-val">{d.value}</div>
            <div className="adl-close">{d.close}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AccountDocs() {
  return (
    <section>
      <h3 className="acct-section-title">
        Documents <span className="muted">· 6 · last updated today 06:14</span>
      </h3>
      <div className="adoc">
        {DOCS_LIST.map((d) => (
          <div key={d.n} className="adoc-row">
            <FileText className="ic c-subtle" aria-hidden="true" />
            <div className="adoc-main">
              <div className="adoc-n">{d.n}</div>
              <div className="adoc-by">{d.by}</div>
            </div>
            <div className="adoc-tag">{d.tag}</div>
            <div className="adoc-size">{d.size}</div>
            <button type="button" className="btn ghost btn-compact">
              Open
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AccountActivity() {
  return (
    <section>
      <h3 className="acct-section-title">
        Activity <span className="muted">· all events · filtered: all</span>
      </h3>
      <div className="aact">
        {ACTIVITY_LIST.map((a, i) => (
          <div key={i} className={`aact-row ${a.tag}`}>
            <div className="aact-t">{a.t}</div>
            <div className={`aact-k ${a.tag}`}>{a.k}</div>
            <div className="aact-who">{a.who}</div>
            <div className="aact-body">{a.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
