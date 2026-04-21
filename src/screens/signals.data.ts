// Static fixture data for the Signals feed.
//
// Lives in a sibling `.data.ts` file (not `signals.tsx`) so React Fast
// Refresh still treats the component file as a pure-component module —
// mixed data + component exports break Fast Refresh and force a full
// reload on every edit.

import type { NounRef } from '../lib/types';

export type SignalKind = 'CYCLE' | 'COMPETITOR' | 'SIGNAL' | 'SPOUSE' | 'GSA' | 'PARTNER';
export type SignalPriority = 'p0' | 'p1' | 'p2';

interface LinkedEntity {
  label: string;
  noun?: NounRef;
}

export interface Signal {
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
