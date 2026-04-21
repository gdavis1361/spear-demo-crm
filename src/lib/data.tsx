import React from 'react';
import type { TodayCard, PromiseItem, Stage, Deal, LeaderboardRow } from './types';
import { moneyFromMajor } from './money';
import { leadId, accountId } from './ids';
import { makeDerived } from '../ontology/lineage';
import { instant } from './time';

const REFRESHED_AT = instant('2026-04-21T08:30:00Z');
const PRIORITY_MODEL = { model: 'spear-priority', version: 3 } as const;

const score = (value: number, contributors: { source: string; label: string; weight: number; objectRef?: string }[]) =>
  makeDerived(value, { ...PRIORITY_MODEL, refreshedAt: REFRESHED_AT, contributors });

// Spear CRM — sample data. PCS-heavy, with corporate + individual mixed in.
//
// All names, emails, and IDs are synthetic: `555-01xx` phone numbers and
// `@example.*` domains follow the US reserved-for-fiction convention.

export const TODAY_CARDS: TodayCard[] = [
  {
    rank: 1, now: true,
    name: 'SSgt. Marcus Alvarez',
    id: 'LD-40218',
    noun: { kind: 'person', id: 'ssgt-marcus-alvarez' },
    idNoun: { kind: 'deal', id: 'LD-40218' },
    kind: 'PCS', branch: 'Army', base: 'Fort Campbell, KY → JBLM, WA',
    why: 'Promised callback at 09:30 PT — 14 min from now.',
    context: <>Has orders report date <span className="emph">Jun 14</span>. Wife Rachel handles logistics during his field exercise. Spouse Facebook group mentioned three bad move horror stories this week. <span className="why-i">She is nervous and we said we'd call.</span></>,
    meta: [
      { t: 'Move weight · ~2,400 lbs', accent: false },
      { t: 'Quoted $2,140 · not signed', accent: false },
      { t: 'Callback due 09:30 PT', accent: true },
    ],
    score: score(96, [
      { source: 'callback_promise_minutes_to_due', label: 'Callback promise · 14 min out', weight: 0.42, objectRef: 'promise:pr_alvarez' },
      { source: 'fb_spouses_thread_volume', label: 'Spouse FB thread · 3 horror stories this week', weight: 0.24 },
      { source: 'quote_sent_unsigned', label: 'Quote sent · not signed', weight: 0.18, objectRef: 'deal:LD-40218' },
      { source: 'pcs_cycle_proximity', label: 'Report date Jun 14 · 54 days', weight: 0.12 },
    ]),
  },
  {
    rank: 2, now: false,
    name: 'MELS Corporate Mobility',
    id: 'ACC-1188',
    noun: { kind: 'account', id: 'acc-1188' },
    idNoun: { kind: 'account', id: 'acc-1188' },
    kind: 'CORP', branch: 'F500 relo', base: 'Atlanta HQ · 42 reps/yr',
    why: 'RFP response due tomorrow — our BAFO still has a placeholder on claims handling.',
    context: <>Katherine Ruiz (mobility lead) forwarded a competitor's proposal Monday; <span className="emph">Weichert undercut us by ~8%</span> on line-haul. She replied "help me help you" — the opening is real, but narrow.</>,
    meta: [
      { t: 'Annual value · $740K est', accent: false },
      { t: 'RFP due Wed 17:00 ET', accent: true },
      { t: 'Last touch · 4d ago', accent: false },
    ],
    score: score(91, [
      { source: 'rfp_due_within_24h', label: 'RFP due Wed 17:00 ET', weight: 0.40, objectRef: 'account:acc-1188' },
      { source: 'competitor_undercut', label: 'Weichert undercut us 8% on line-haul', weight: 0.28 },
      { source: 'champion_open_signal', label: 'K. Ruiz: "help me help you"', weight: 0.16 },
      { source: 'annual_value_band', label: '$740K annual MSA bracket', weight: 0.07 },
    ]),
  },
  {
    rank: 3, now: false,
    name: 'CW3 Diane Park',
    id: 'LD-40201',
    noun: { kind: 'person', id: 'cw3-diane-park' },
    kind: 'PCS', branch: 'Army Aviation', base: 'Rucker, AL → Wainwright, AK',
    why: 'Signal: opened our "Alaska PCS checklist" email four times yesterday.',
    context: <>Aviation families route through Seattle — we have a partner network gap there that closes next month. Honest move: <span className="emph">tell her now</span> and co-plan the timeline. Silence is worse than bad news.</>,
    meta: [
      { t: 'Move weight · ~7,800 lbs (family of 5)', accent: false },
      { t: 'Branch · NDE (non-temp storage) case', accent: false },
      { t: 'Signal · 4 email opens', accent: false },
    ],
    score: score(84, [
      { source: 'email_open_velocity', label: '4 opens · "Alaska PCS checklist"', weight: 0.35, objectRef: 'person:cw3-diane-park' },
      { source: 'partner_gap_lane', label: 'Known AK partner gap (closing next month)', weight: 0.22 },
      { source: 'family_size_complexity', label: 'Family of 5 · NDE storage', weight: 0.15 },
      { source: 'aviation_route_seattle', label: 'Aviation routing through Seattle hub', weight: 0.08 },
    ]),
  },
  {
    rank: 4, now: false,
    name: 'Lt. Col. Emmanuel Oduya',
    id: 'LD-40176',
    kind: 'PCS', branch: 'USAF', base: 'Ramstein, DE → Wright-Patterson, OH',
    why: 'OCONUS → CONUS. Quote expired Monday; spouse replied "we just got our orders."',
    context: <>Four-month window before report date. Reply was warm but short. Re-quote with updated fuel surcharge and <span className="emph">mention the JPPSO coordinator by name</span> — they'd trust that.</>,
    meta: [
      { t: 'International · port-of-entry Baltimore', accent: false },
      { t: 'Quoted 21d ago · $6,410', accent: false },
      { t: 'Report date · Sep 08', accent: false },
    ],
    score: score(78, [
      { source: 'quote_expired', label: 'Quote expired Monday', weight: 0.30, objectRef: 'deal:LD-40176' },
      { source: 'oconus_to_conus_window', label: 'OCONUS→CONUS · 4-month window', weight: 0.22 },
      { source: 'spouse_warm_reply', label: 'Spouse replied warm', weight: 0.18 },
      { source: 'jppso_named_contact', label: 'JPPSO coordinator name in our notes', weight: 0.08 },
    ]),
  },
  {
    rank: 5, now: false,
    name: 'Atlas Federal (GSA task order)',
    id: 'ACC-1192',
    kind: 'GSA', branch: 'Gov', base: '14 civilian DOE relocations',
    why: 'Our win rate on sub-contract GSA work dropped 18% last quarter. Worth a call to procurement to diagnose.',
    context: <>Teresa Hadley was supportive of our bid but <span className="emph">budget authority shifted</span> to her regional director in March. We haven't had a conversation with him yet.</>,
    meta: [
      { t: 'Task order value · $1.2M', accent: false },
      { t: 'Cycle · FY26 obligations', accent: false },
      { t: 'Owner intro pending', accent: false },
    ],
    score: score(72, [
      { source: 'gsa_win_rate_drop', label: 'GSA win rate down 18% QoQ', weight: 0.34 },
      { source: 'budget_authority_shift', label: 'Budget authority shifted to regional dir', weight: 0.22 },
      { source: 'task_order_size', label: '$1.2M task order', weight: 0.10 },
      { source: 'champion_supportive', label: 'Hadley supportive of our bid', weight: 0.06 },
    ]),
  },
];

export const PROMISES: PromiseItem[] = [
  { t: 'Call R. Alvarez — new delivery window', when: 'Tomorrow · 09:30 PT', cls: 'soon' },
  { t: 'Send TLE paperwork · MV-30418', when: 'Due today · 15:45', cls: 'soon' },
  { t: 'BAFO response to MELS Corporate', when: 'Wed · 17:00 ET', cls: 'overdue' },
  { t: 'Follow-up to CW3 Park re: Alaska gap', when: 'This week', cls: '' },
  { t: 'Intro call w/ M. Thibault (Atlas regional)', when: 'Next week', cls: '' },
];

export const STAGES: Stage[] = [
  { k: 'inbound', label: 'Inbound',    color: 'var(--status-info)', count: 18, value: moneyFromMajor(124_000) },
  { k: 'qualify', label: 'Qualifying', color: 'var(--olive-500)',   count: 12, value: moneyFromMajor(186_000) },
  { k: 'scoping', label: 'Scoping',    color: 'var(--olive-600)',   count:  9, value: moneyFromMajor(241_000) },
  { k: 'quote',   label: 'Quoted',     color: 'var(--accent)',      count: 14, value: moneyFromMajor(412_000) },
  { k: 'verbal',  label: 'Verbal',     color: 'var(--accent)',      count:  6, value: moneyFromMajor(287_000) },
  { k: 'won',     label: 'Won — 30d',  color: 'var(--olive-500)',   count: 11, value: moneyFromMajor(348_000) },
];

export const DEALS: Deal[] = [
  // inbound
  { stage: 'inbound',  dealId: leadId('ld_40288'),    displayId: 'LD-40288', title: 'SPC R. Holt',             meta: 'Benning → Lewis · PCS cycle Aug',       branch: 'Army',     value: moneyFromMajor(1_840),   tags: ['PCS','Self-service'] },
  { stage: 'inbound',  dealId: leadId('ld_40290'),    displayId: 'LD-40290', title: 'Ava Moreno',              meta: 'Austin → Boston · individual full-service', branch: 'Civ',  value: moneyFromMajor(2_710),   tags: ['INDIV'] },
  { stage: 'inbound',  dealId: leadId('ld_40301'),    displayId: 'LD-40301', title: 'Hartley Dental Group',    meta: 'Clinic relocation · Charlotte',         branch: 'SMB',      value: moneyFromMajor(8_400),   tags: ['CORP'] },
  // qualify
  { stage: 'qualify',  dealId: leadId('ld_40276'),    displayId: 'LD-40276', title: 'Capt. Julian Soto',       meta: 'Coronado → Norfolk · partial-pack',     branch: 'Navy',     value: moneyFromMajor(3_150),   tags: ['PCS'], hot: true },
  { stage: 'qualify',  dealId: leadId('ld_40268'),    displayId: 'LD-40268', title: 'Brightwell Energy Inc.',  meta: 'Houston HQ · 12 relocations/yr',        branch: 'F500',     value: moneyFromMajor(220_000), tags: ['CORP'] },
  { stage: 'qualify',  dealId: leadId('ld_40271'),    displayId: 'LD-40271', title: 'MSgt. Keaton Vargas',     meta: 'Eglin → Yokota, JA · OCONUS',           branch: 'USAF',     value: moneyFromMajor(6_920),   tags: ['PCS','INTL'] },
  // scoping
  { stage: 'scoping',  dealId: leadId('ld_40218'),    displayId: 'LD-40218', title: 'SSgt. M. Alvarez',        meta: 'Campbell → JBLM · full-pack',           branch: 'Army',     value: moneyFromMajor(2_140),   tags: ['PCS'], hot: true },
  { stage: 'scoping',  dealId: leadId('ld_40201'),    displayId: 'LD-40201', title: 'CW3 Diane Park',          meta: 'Rucker → Wainwright · family of 5',     branch: 'Army Avn', value: moneyFromMajor(8_300),   tags: ['PCS','INTL GAP'] },
  { stage: 'scoping',  dealId: leadId('ld_40247'),    displayId: 'LD-40247', title: 'Rohit Krishnan',          meta: 'SF → Austin · corporate relo',          branch: 'Civ',      value: moneyFromMajor(4_410),   tags: ['CORP'] },
  // quote
  { stage: 'quote',    dealId: leadId('ld_40176'),    displayId: 'LD-40176', title: 'Lt. Col. E. Oduya',       meta: 'Ramstein → WPAFB · OCONUS',             branch: 'USAF',     value: moneyFromMajor(6_410),   tags: ['PCS','EXPIRED'], warm: true },
  { stage: 'quote',    dealId: accountId('acc_1188'), displayId: 'ACC-1188', title: 'MELS Corporate Mobility', meta: 'Annual MSA · F500 mobility',            branch: 'F500',     value: moneyFromMajor(740_000), tags: ['CORP','BAFO'], hot: true },
  { stage: 'quote',    dealId: leadId('ld_40155'),    displayId: 'LD-40155', title: 'CDR Teresa Whitlock',     meta: 'Mayport → Whidbey · household',         branch: 'Navy',     value: moneyFromMajor(4_890),   tags: ['PCS'] },
  { stage: 'quote',    dealId: leadId('ld_40149'),    displayId: 'LD-40149', title: 'Atlas Federal (GSA)',     meta: 'DOE civ. task order · 14 moves',        branch: 'Gov',      value: moneyFromMajor(1_200_000), tags: ['GSA'] },
  // verbal
  { stage: 'verbal',   dealId: leadId('ld_40112'),    displayId: 'LD-40112', title: 'SSG Priya Raman',         meta: 'Bragg → Hood · partial',                branch: 'Army',     value: moneyFromMajor(1_410),   tags: ['PCS'] },
  { stage: 'verbal',   dealId: leadId('ld_40108'),    displayId: 'LD-40108', title: 'Nordlight Capital',       meta: 'Executive household · 3 stops',         branch: 'F500',     value: moneyFromMajor(38_000),  tags: ['WHITE-GLOVE'] },
  // won
  { stage: 'won',      dealId: leadId('ld_40021'),    displayId: 'LD-40021', title: 'Maj. L. Okafor',          meta: 'Closed · signed Apr 08',                branch: 'Army',     value: moneyFromMajor(3_220),   tags: ['PCS'] },
  { stage: 'won',      dealId: leadId('ld_40015'),    displayId: 'LD-40015', title: 'Redwood Biotech Inc.',    meta: '8 relocations Q2',                      branch: 'F500',     value: moneyFromMajor(64_000),  tags: ['CORP'] },
];

export const LEADERBOARD: LeaderboardRow[] = [
  { pos: '01', n: 'M. Hall',       pod: 'DOD-SE',   val: moneyFromMajor(318_000), delta: '+12%', cls: 'up' },
  { pos: '02', n: 'K. Okonkwo',    pod: 'DOD-SE',   val: moneyFromMajor(271_000), delta: '+4%',  cls: 'up' },
  { pos: '03', n: 'S. Brennan',    pod: 'Corp-EN',  val: moneyFromMajor(244_000), delta: '—',    cls: '' },
  { pos: '04', n: 'D. Laurent',    pod: 'DOD-NW',   val: moneyFromMajor(218_000), delta: '+9%',  cls: 'up' },
  { pos: '05', n: 'R. Hemming',    pod: 'Indiv',    val: moneyFromMajor(186_000), delta: '−3%',  cls: 'down' },
  { pos: '06', n: 'J. Pellegrini', pod: 'Corp-WS',  val: moneyFromMajor(162_000), delta: '+1%',  cls: 'up' },
];
