import React from 'react';
import { MapPin, Users, User, Calendar, Paperclip, FileText, AtSign, Save, Send, X, Edit3, Eye, Zap, CheckCircle, Mail, Clock, UserPlus, Flag } from 'lucide-react';
import { AccountDeals, AccountDocs, AccountActivity, HonestDraft } from '../components/extras';
import { runHistory } from '../app/runtime';
import { PCS_CYCLE_OUTREACH } from '../domain/workflow-def';
import { ageShort } from '../lib/time';
import type { RunResult } from '../domain/workflow-runner';

// Account 360, Quote, Workflows

type AccountTab = 'story' | 'details' | 'deals' | 'docs' | 'activity';
type RightTab = 'comms' | 'tasks' | 'docs';

const ACCOUNT_TABS: AccountTab[] = ['story', 'details', 'deals', 'docs', 'activity'];

export function Account() {
  const [tab, setTab] = React.useState<AccountTab>('story');
  const [rtab, setRtab] = React.useState<RightTab>('comms');

  return (
    <div className="acct">
      <div className="acct-left">
        <div className="acct-header">
          <div className="crumbs">Accounts · Corporate · F500 mobility</div>
          <div className="id-row">
            <span className="mono-id">ACC-1188</span>
            <span className="op-40">·</span>
            <span className="chip info">F500 mobility</span>
            <span className="chip accent">Hot · BAFO window</span>
            <span className="chip">MSA · annual</span>
          </div>
          <h1>MELS Corporate Mobility</h1>
          <div className="subtitle">
            <em>We are within $42K of winning their annual MSA.</em> Weichert undercut our line-haul by 8%. Katherine Ruiz, the mobility lead, said "help me help you" on Monday — a phrase she does not throw around.
          </div>
          <div className="tagline">
            <span className="t"><MapPin className="ic-sm" aria-hidden="true" />Atlanta, GA · HQ</span>
            <span className="t"><Users className="ic-sm" aria-hidden="true" />42 relocations / yr</span>
            <span className="t"><User className="ic-sm" aria-hidden="true" />Owner · M. Hall</span>
            <span className="t"><Calendar className="ic-sm" aria-hidden="true" />Since Jun 2024</span>
          </div>
        </div>
        <div className="acct-tabs" role="tablist">
          {ACCOUNT_TABS.map(t => (
            <button type="button" key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'story' ? 'Relationship' : t}
            </button>
          ))}
        </div>

        <div className="acct-body">
          {tab === 'story' && (
            <>
              <section>
                <h3 className="acct-section-title">Relationship story <span className="muted">· the last 90 days that matter</span></h3>
                <div className="story">
                  <div className="s k-now">
                    <div className="when">Today · 08:12 CDT · open</div>
                    <div className="title">Katherine forwarded Weichert's proposal — "help me help you"</div>
                    <div className="body">She flagged line-haul pricing as the only remaining gap. She did not name the number; we inferred <em>~8% below us</em> from the line items. The BAFO window closes Wed at 17:00 ET.</div>
                  </div>
                  <div className="s">
                    <div className="when">Apr 14 · 11:40 ET</div>
                    <div className="title">Quarterly business review · Atlanta HQ</div>
                    <div className="body">Katherine, plus her ops lead Rene Odita. They asked one question three times: <em>"when something breaks on a move, who actually calls the employee?"</em> — our dispatcher model resonated.</div>
                  </div>
                  <div className="s">
                    <div className="when">Mar 06</div>
                    <div className="title">Claims on the Oduya move (ACC-1188 / LD-40021) — closed same-day</div>
                    <div className="body">Ceramic humidor, $1,200, damaged in transit. Claim paid inside 36 hours with no litigation. Katherine cited this unprompted in the QBR — it is the reason we are still in the running.</div>
                  </div>
                  <div className="s">
                    <div className="when">Feb 18</div>
                    <div className="title">First executive meeting · introduced to Rene Odita</div>
                    <div className="body">Rene's ops background means he reads the dispatch cadence differently from Katherine — he asked about SLA penalty clauses, which is a signal.</div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="acct-section-title">At a glance</h3>
                <div className="acct-kv">
                  <div><div className="k">Contract type</div><div className="v">Annual MSA</div></div>
                  <div><div className="k">Current MSA</div><div className="v mono">MSA-2025-041</div></div>
                  <div><div className="k">Annual relocations</div><div className="v">42 <span className="sm">forecast, based on 12-mo trailing</span></div></div>
                  <div><div className="k">ACV · proposed</div><div className="v c-accent">$740,000</div></div>
                  <div><div className="k">Primary contact</div><div className="v">Katherine Ruiz <span className="sm">VP, Global Mobility</span></div></div>
                  <div><div className="k">Secondary</div><div className="v">Rene Odita <span className="sm">Dir., Mobility Ops</span></div></div>
                  <div><div className="k">Our owner</div><div className="v">M. Hall <span className="sm">AE · Corp-EN</span></div></div>
                  <div><div className="k">Competitors</div><div className="v">Weichert, Graebel <span className="sm">Sirva previously · declined to bid</span></div></div>
                </div>
              </section>

              <section>
                <h3 className="acct-section-title">Open work</h3>
                <div className="acct-kv">
                  <div><div className="k">BAFO due</div><div className="v c-accent">Wed 17:00 ET <span className="sm">· ~31 hours out</span></div></div>
                  <div><div className="k">Line-haul ask</div><div className="v">Match on 5 routes <span className="sm">ATL-DFW, ATL-CHI, ATL-LAX, ATL-SEA, ATL-NYC</span></div></div>
                  <div><div className="k">Claims handling</div><div className="v">Add a named contact <span className="sm">Katherine asked by name for this</span></div></div>
                  <div><div className="k">Partner network</div><div className="v">Confirm ATL-SEA coverage <span className="sm">our known gap · mitigation plan required</span></div></div>
                </div>
              </section>
            </>
          )}
          {tab === 'details' && (
            <section>
              <h3 className="acct-section-title">Details</h3>
              <div className="acct-kv">
                <div><div className="k">Legal name</div><div className="v">MELS Corporate Mobility, Inc.</div></div>
                <div><div className="k">DUNS</div><div className="v mono">07-842-1190</div></div>
                <div><div className="k">HQ</div><div className="v">1100 Peachtree St NE, Atlanta GA 30309</div></div>
                <div><div className="k">Billing</div><div className="v">AP portal · Net-45</div></div>
                <div><div className="k">Industry</div><div className="v">F500 corporate mobility</div></div>
                <div><div className="k">Employees</div><div className="v">~32,000</div></div>
                <div><div className="k">Fiscal year</div><div className="v">Jan–Dec</div></div>
                <div><div className="k">Procurement cycle</div><div className="v">Renewals open April 1</div></div>
              </div>
            </section>
          )}
          {tab === 'deals' && <AccountDeals />}
          {tab === 'docs' && <AccountDocs />}
          {tab === 'activity' && <AccountActivity />}
        </div>
      </div>

      <aside className="acct-right">
        <div className="rr-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={rtab === 'comms'} className={rtab === 'comms' ? 'on' : ''} onClick={() => setRtab('comms')}>Comms <span className="count">12</span></button>
          <button type="button" role="tab" aria-selected={rtab === 'tasks'} className={rtab === 'tasks' ? 'on' : ''} onClick={() => setRtab('tasks')}>Tasks <span className="count">4</span></button>
          <button type="button" role="tab" aria-selected={rtab === 'docs'} className={rtab === 'docs' ? 'on' : ''} onClick={() => setRtab('docs')}>Docs <span className="count">6</span></button>
        </div>
        {rtab === 'comms' && (
          <>
            <div className="comms-who">
              <div className="av">KR</div>
              <div>
                <div className="who-name">Katherine Ruiz</div>
                <div className="who-sub">VP, Global Mobility · MELS · last read 08:12 CDT</div>
              </div>
            </div>
            <div className="msgs">
              <div className="msg">
                <div className="m-head"><span className="name">K. Ruiz</span><span>08:09 CDT</span></div>
                Forwarding Weichert's proposal. Line-haul pricing is the one thing holding me back. Help me help you.
              </div>
              <div className="msg mine">
                <div className="m-head"><span className="name">M. Hall</span><span>08:14 CDT</span></div>
                Reading now. I'll have a numbered response to you in 60 minutes — not a new quote, an honest answer on the five ATL lanes that matter. If we can't match on all five, we'll say so.
              </div>
              <div className="msg">
                <div className="m-head"><span className="name">K. Ruiz</span><span>08:15 CDT</span></div>
                Appreciate that. Rene will join the 3pm if you want to talk through the SLA language too.
              </div>
            </div>
            <div className="compose">
              <textarea placeholder="Reply to Katherine…" defaultValue=""></textarea>
              <div className="foot">
                <div className="tools">
                  <button type="button" aria-label="Attach file"><Paperclip className="ic-sm" aria-hidden="true" /></button>
                  <button type="button" aria-label="Insert document"><FileText className="ic-sm" aria-hidden="true" /></button>
                  <button type="button" aria-label="Mention person"><AtSign className="ic-sm" aria-hidden="true" /></button>
                </div>
                <button type="button" className="btn primary">Send <kbd>⌘↵</kbd></button>
              </div>
            </div>
          </>
        )}
        {rtab === 'tasks' && (
          <>
            <div className="task-row">
              <div className="box"></div>
              <div><div className="title">BAFO response · line-haul narrative for 5 ATL lanes</div><div className="sub">Due Wed 17:00 ET · BAFO window</div></div>
              <div className="due soon">Tomorrow</div>
            </div>
            <div className="task-row">
              <div className="box"></div>
              <div><div className="title">Confirm ATL → SEA partner coverage</div><div className="sub">Coordinate with Partner Ops · N. Fogerty</div></div>
              <div className="due soon">Today</div>
            </div>
            <div className="task-row">
              <div className="box"></div>
              <div><div className="title">Add named claims contact to proposal</div><div className="sub">Katherine asked by name</div></div>
              <div className="due">This week</div>
            </div>
            <div className="task-row done">
              <div className="box"></div>
              <div><div className="title">Pull Weichert line-haul rate card</div><div className="sub">Completed by S. Brennan</div></div>
              <div className="due">Done</div>
            </div>
          </>
        )}
        {rtab === 'docs' && (
          <>
            {['MSA-2025-041 · draft v3.pdf','Weichert proposal · forwarded Apr 20.pdf','QBR deck · Apr 14.pptx','Claims case · Oduya · Mar 06.pdf','Line-haul rate card · ATL lanes.xlsx','Partner coverage map · Q2.pdf'].map(n => (
              <div key={n} className="task-row">
                <FileText className="ic-sm c-subtle doc-icon" aria-hidden="true" />
                <div><div className="title">{n}</div><div className="sub">Updated today</div></div>
                <div className="due">View</div>
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}

interface QuoteLine {
  k: string;
  sub: string;
  qty: string;
  unit: string;
  total: number;
}

export function Quote() {
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [honest, setHonest] = React.useState(`We don't own the trucks. We coordinate the people who do, and we're accountable for the outcome. This quote covers Jun 08 pack and a 4–5 day line-haul, with delivery window Jun 13–15 at JBLM. If anything slips, your dispatcher is Marcus Hall — he reads and responds himself.`);
  const [lines, setLines] = React.useState<QuoteLine[]>([
    { k: 'Origin services · Full-pack', sub: '2,240 lbs · 4 containers · 2 crew', qty: '1', unit: '$420', total: 420 },
    { k: 'Line-haul · Campbell, KY → JBLM, WA', sub: '2,156 mi · est. 4.5 days', qty: '2,156', unit: '$0.78/mi', total: 1682 },
    { k: 'Destination services · unload & set', sub: '4 containers · 1 crew · 3 hrs', qty: '1', unit: '$180', total: 180 },
    { k: 'Full-value protection rider', sub: '$60,000 declared value · $0 deductible', qty: '1', unit: '$142', total: 142 },
    { k: 'Gate-4 clearance · JBLM', sub: 'Base access · pre-filed', qty: '1', unit: 'Included', total: 0 },
  ]);
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const fuel = Math.round(subtotal * 0.085);
  const total = subtotal + fuel;

  return (
    <div className="quote">
      <div className="quote-left">
        <div className="quote-head">
          <div>
            <div className="eyebrow">Quote builder · new</div>
            <h1>New quote · LD-40218</h1>
            <div className="sub">For SSgt. Marcus Alvarez — Fort Campbell, KY → Joint Base Lewis-McChord, WA. Report date Jun 14. Rachel Alvarez is handling logistics.</div>
          </div>
          <div className="row-gap-6">
            <button type="button" className="btn"><Save className="ic-sm" aria-hidden="true" />Save draft</button>
            <button type="button" className="btn primary"><Send className="ic-sm" aria-hidden="true" />Send to shipper</button>
          </div>
        </div>

        <section className="quote-section">
          <h3>Move scope <span className="step">Step 1 · 4</span></h3>
          <div className="q-grid">
            <div className="q-field"><div className="lbl">Shipper</div><div className="val">SSgt. Marcus Alvarez · Army</div></div>
            <div className="q-field"><div className="lbl">Order ref · DD-1299</div><div className="val">DD-1299 · PCS authorized</div></div>
            <div className="q-field"><div className="lbl">Origin</div><input defaultValue="Fort Campbell, KY · Housing area 3" /></div>
            <div className="q-field"><div className="lbl">Destination</div><input defaultValue="Joint Base Lewis-McChord, WA · gate 4" /></div>
            <div className="q-field"><div className="lbl">Report date</div><input defaultValue="Jun 14, 2026" /></div>
            <div className="q-field"><div className="lbl">Requested pack</div><input defaultValue="Jun 08 · AM window" /></div>
            <div className="q-field"><div className="lbl">Estimated weight</div><input defaultValue="2,240 lbs" /></div>
            <div className="q-field"><div className="lbl">Service tier</div>
              <select defaultValue="full"><option value="full">Full-pack · full-service</option><option>Partial-pack</option><option>Self-pack</option></select>
            </div>
          </div>
        </section>

        <section className="quote-section">
          <h3>Line items <span className="step">Step 2 · 4</span></h3>
          <div className="q-lines">
            <div className="h">Service</div>
            <div className="h right">Qty</div>
            <div className="h right">Unit</div>
            <div className="h right">Total</div>
            <div className="h"></div>
            {lines.map((l, i) => (
              <React.Fragment key={i}>
                <div className="c title">{l.k}<span className="sub">{l.sub}</span></div>
                <div className="c mono qty-right">{l.qty}</div>
                <div className="c mono qty-right">{l.unit}</div>
                <div className="c right">{l.total ? `$${l.total.toLocaleString()}` : '—'}</div>
                <button type="button" className="c xbtn" aria-label={`Remove line: ${l.k}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="ic-sm" aria-hidden="true" /></button>
              </React.Fragment>
            ))}
          </div>
          <div className="q-lines-add">+ Add line · crating, storage, valuation, crew overtime</div>
        </section>

        <section className="quote-section">
          <h3>Accountability copy <span className="step">Step 3 · 4</span></h3>
          <div className="q-field">
            <div className="row-hbetween">
              <div className="lbl">Honest note to Rachel Alvarez</div>
              <button type="button" className="btn" onClick={() => setDraftOpen(true)}><Edit3 className="ic-sm" aria-hidden="true" />Open drafter</button>
            </div>
            <div className="honest-preview">
              {honest}
            </div>
          </div>
        </section>

        <HonestDraft open={draftOpen} onClose={() => setDraftOpen(false)} onInsert={(txt) => setHonest(txt)} />
      </div>

      <aside className="quote-right">
        <div className="qp-head">
          <div className="l">Live preview · what the shipper sees</div>
          <div className="who">PDF · MV-30418</div>
        </div>
        <div className="qp-preview">
          <div className="qp-title">Your move, quoted.</div>
          <div className="qp-lede">Fort Campbell, KY to Joint Base Lewis-McChord, WA. Full-pack. <em>$2,140 total</em>, locked for 30 days from signing.</div>
          {lines.map((l, i) => (
            <div key={i} className="qp-lines-row">
              <div className="d">{l.k}</div>
              <div className="v">{l.total ? `$${l.total.toLocaleString()}` : 'Included'}</div>
            </div>
          ))}
          <div className="qp-lines-row">
            <div className="d">Fuel surcharge · 8.5%</div>
            <div className="v">${fuel.toLocaleString()}</div>
          </div>
          <div className="qp-lines-row total">
            <div className="d">Total · locked 30 days</div>
            <div className="v">${total.toLocaleString()}</div>
          </div>
        </div>
        <div className="qp-validation">
          VALIDATION · WCAG AA contrast passes on both grounds. Focus rings visible on all fields. Screen-reader labels attached to each q-field.
        </div>
        <div className="qp-foot">
          <button type="button" className="btn"><Eye className="ic-sm" aria-hidden="true" />Preview</button>
          <button type="button" className="btn primary"><Send className="ic-sm" aria-hidden="true" />Send</button>
        </div>
      </aside>
    </div>
  );
}

interface Flow {
  id: string;
  name: string;
  meta: string;
  dotCls: '' | 'paused' | 'off';
  active?: boolean;
}

export function Workflows() {
  const [on, setOn] = React.useState(true);

  const flows: Flow[] = [
    { id: 'wf-01', name: 'PCS cycle outreach', meta: '18 base cycles · active', dotCls: '', active: true },
    { id: 'wf-02', name: 'OCONUS quote · partner-gap honesty', meta: '3 lanes · active', dotCls: '' },
    { id: 'wf-03', name: 'Quote expiring · re-engage', meta: 'All quote > 14d', dotCls: '' },
    { id: 'wf-04', name: 'Spouse-group signal · Facebook', meta: 'Paused — review Apr 25', dotCls: 'paused' },
    { id: 'wf-05', name: 'GSA · task order watchlist', meta: '14 task orders', dotCls: '' },
    { id: 'wf-06', name: 'Corporate RFP · BAFO reminders', meta: 'Off', dotCls: 'off' },
  ];

  return (
    <div className="wf">
      <div className="wf-head">
        <div className="eyebrow">Automation · 6 active flows · 24 paused</div>
        <h1>Workflows</h1>
        <div className="sub">Automation that buys the rep time to make a real call. These flows do the clerical work — they never speak for us.</div>
      </div>
      <div className="wf-body">
        <div className="wf-list">
          <div className="wf-list-head">Active flows</div>
          {flows.map((f, i) => (
            <div key={f.id} className={`wf-list-item${i === 0 ? ' on' : ''}`}>
              <div className="name">{f.name}</div>
              <div className="meta">
                <span className={`dot ${f.dotCls}`}></span>
                <span>{f.meta}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="wf-canvas">
          <div className="meta-row">
            <div>
              <h2>PCS cycle outreach</h2>
              <div className="desc">When a base enters its 120-day PCS cycle window, we reach out to families with orders — by name, with their JPPSO coordinator named too. We do not send generic blasts.</div>
            </div>
            <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => setOn(!on)}>
              <span>{on ? 'Active' : 'Off'}</span>
              <div className="track"></div>
            </button>
          </div>

          <div className="wf-steps">
            <div className="wf-step trigger">
              <div className="ico"><Zap className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">Trigger</div>
                <div className="t">Base enters <em>120-day PCS cycle window</em></div>
                <div className="d">Source: MilMove cycle calendar + SDDC publication. Triggers once per family per cycle. We have checked the unsubscribe state before the trigger fires.</div>
              </div>
              <div className="rhs">Fires ~ 40–60/wk</div>
            </div>
            <div className="wf-step">
              <div className="ico"><CheckCircle className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">Filter</div>
                <div className="t">Has orders on file AND has not received a quote from us in the last 180 days</div>
                <div className="d">We will never re-pitch a family that just moved with us. We will not pitch a family whose orders are tentative.</div>
              </div>
              <div className="rhs">~ 60% pass</div>
            </div>
            <div className="wf-step">
              <div className="ico"><Mail className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">Action · Email</div>
                <div className="t">Send <em>"Your PCS checklist from someone who's done it"</em> (template · named dispatcher)</div>
                <div className="d">Template is sentence-case, no exclamation points, names the JPPSO coordinator for their base. Dispatcher is chosen by territory, not round-robin.</div>
              </div>
              <div className="rhs">Open · 38%</div>
            </div>
            <div className="wf-step">
              <div className="ico"><Clock className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">Wait</div>
                <div className="t">48 hours · or until they reply</div>
                <div className="d">Reply bypasses the wait and routes to the dispatcher immediately. Silence is not treated as an answer.</div>
              </div>
              <div className="rhs"></div>
            </div>
            <div className="wf-step">
              <div className="ico"><UserPlus className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">Action · Create task</div>
                <div className="t">Assign dispatcher a <em>"30-second look"</em> task — not a call</div>
                <div className="d">A rep glances at the family's history, orders type, and any Facebook spouse group signals before deciding whether to call. No auto-calls. No dialers.</div>
              </div>
              <div className="rhs">Task · 2 min</div>
            </div>
            <div className="wf-step">
              <div className="ico"><Flag className="ic-sm" aria-hidden="true" /></div>
              <div className="body">
                <div className="k">End</div>
                <div className="t">Add to Today queue · rank by report-date proximity</div>
                <div className="d">Lands on the rep's Today list. Time-sensitivity, not score.</div>
              </div>
              <div className="rhs"></div>
            </div>
          </div>

          <div className="wf-add">+ Add step · filter · action · branch · wait</div>

          <RunHistoryTable />
          <VersionBadge />
        </div>
      </div>
    </div>
  );
}

function VersionBadge() {
  return (
    <div className="wf-version-badge">
      Definition <code>v{PCS_CYCLE_OUTREACH.version}</code> · in-flight runs pin to their starting version
    </div>
  );
}

function RunHistoryTable() {
  const [runs, setRuns] = React.useState<readonly RunResult[]>([]);
  React.useEffect(() => {
    return runHistory.subscribe(() => setRuns(runHistory.recent(PCS_CYCLE_OUTREACH.id, 5)));
  }, []);

  return (
    <div className="wf-run-history">
      <h4>Last 5 runs</h4>
      {runs.length === 0 && <div className="wf-run-empty">No runs yet · waiting for trigger</div>}
      {runs.map((r) => {
        const lastStep = r.steps[r.steps.length - 1];
        const isFailure = r.steps.some((s) => s.outcome === 'failed');
        const status: 'ok' | 'err' = isFailure || r.disposition === 'dropped' ? 'err' : 'ok';
        const statusLabel = r.disposition === 'waiting' ? 'Waiting'
          : r.disposition === 'dropped' ? 'Skipped'
          : isFailure ? 'Failed'
          : 'Completed';
        const startedAt = r.events.find((e) => e.kind === 'workflow.run_started')?.at;
        return (
          <div key={r.runId} className="wf-run">
            <span className="t">{startedAt ? `${ageShort(startedAt)} ago` : '—'}</span>
            <span className="n mono">{r.runId}</span>
            <span className={`status ${status}`}>{statusLabel}</span>
            <span className="t ta-right">{lastStep?.label ?? r.disposition}</span>
          </div>
        );
      })}
    </div>
  );
}

