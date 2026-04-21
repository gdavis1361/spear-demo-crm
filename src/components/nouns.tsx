import React from 'react';
import { ChevronLeft, Maximize2, X, Command, Search } from 'lucide-react';
import type { NounRef, NounKind, Role } from '../lib/types';
import { useApp } from '../app/context';
import { readString, writeString, removeKey } from '../app/state';

// ============================================================================
// Nouns & Verbs system — Vercel lens
//
// Every entity (person, account, deal, base, signal, doc, promise, rep, lane,
// competitor) is a first-class Noun. Wherever it appears in the UI, it's a
// live handle: hover for inline verbs, click for peek drawer, cmd-click for
// full drill, ⌘K for fuzzy finder.
//
// Verbs realign based on (nounKind, state, role). One source of truth.
// ============================================================================

// ─── Noun registry ──────────────────────────────────────────────────────────
// Canonical data for nouns referenced across the app. Minimal — just enough
// to render a peek and a command. Real system would pull from API.

const NOUN_REGISTRY = {
  person: {
    'cw3-diane-park': {
      kind: 'person', id: 'cw3-diane-park', label: 'CW3 Diane Park',
      role: 'Army · CW3 · signal corps', base: 'rucker', account: null,
      state: 'active-lead', dealId: null,
      meta: ['Rucker → Wainwright', 'OCONUS · Alaska'],
      editorial: 'Opened four tabs on the Alaska PCS checklist page in the last 48 hours. Two from a mobile viewport at 22:40. The spouse is the researcher here — not Diane.',
      phone: '+1 334 555 0199', email: 'dmp.park@example.mil',
    },
    'ssgt-marcus-alvarez': {
      kind: 'person', id: 'ssgt-marcus-alvarez', label: 'SSgt. Marcus Alvarez',
      role: 'Air Force · SSgt · maintenance', base: 'campbell', account: null,
      state: 'in-quote', dealId: 'LD-40218',
      meta: ['Campbell → JBLM', 'PCS · July'],
      editorial: 'Wife is running lead on this one. She posted to the Campbell spouses group Monday asking who people used for their last Washington move. Three recommendations named us. One of them was Rachel\'s sister-in-law.',
      phone: '+1 931 555 0142', email: 'marcus.alvarez.3@example.mil',
    },
    'capt-rachel-wu': {
      kind: 'person', id: 'capt-rachel-wu', label: 'Capt. Rachel Wu',
      role: 'Army · Capt · quartermaster', base: 'benning', account: null,
      state: 'in-quote', dealId: 'LD-40211',
      meta: ['Benning → Fort Liberty', 'PCS · June'],
      editorial: 'Second call. Quote is sent. Her delivery window shifted by 9 days after a school-calendar change — asked about flexible pack dates.',
      phone: '+1 706 555 0181', email: 'rachel.wu@example.mil',
    },
    'k-ruiz': {
      kind: 'person', id: 'k-ruiz', label: 'Katherine Ruiz',
      role: 'MELS · VP Mobility', base: null, account: 'acc-1188',
      state: 'in-bafo',
      meta: ['Atlanta HQ', 'Decision-maker'],
      editorial: 'Forwarded the Weichert proposal Monday. Her note: "help me help you." That\'s not an objection — that\'s an opening. She wants to keep us.',
      phone: '+1 404 555 0140', email: 'kruiz@example.com',
    },
    'j-brennan': {
      kind: 'person', id: 'j-brennan', label: 'J. Brennan',
      role: 'Rep · DOD-SE pod', base: null, account: null,
      state: 'at-risk',
      meta: ['No activity 2h+', 'Queue stale'],
      editorial: 'Has not touched the queue today. Four promises open. One overdue by 36 hours. This is unusual for Brennan — last stale day was Feb 14.',
    },
    'r-hemming': {
      kind: 'person', id: 'r-hemming', label: 'R. Hemming',
      role: 'Rep · Indiv pod', base: null, account: null,
      state: 'at-risk',
      meta: ['48 deals · 2 overdue promises'],
      editorial: 'Carrying an 48-deal queue solo. This is a staffing problem, not a performance problem. Two overdue promises have been flagged in the system for 36+ hours.',
    },
    'm-hall': {
      kind: 'person', id: 'm-hall', label: 'M. Hall',
      role: 'Rep · DOD-SE pod · pod lead', base: null, account: null,
      state: 'performing',
      meta: ['$318K MTD · +12%'],
      editorial: 'Producing 48% of pod MRR. Concentration risk: the week she takes PTO we lose pipeline momentum on two irreplaceable deals.',
    },
  },
  account: {
    'acc-1188': {
      kind: 'account', id: 'acc-1188', label: 'MELS Corporate Mobility',
      state: 'in-bafo',
      meta: ['F500', 'Atlanta HQ', '42 relos/yr', '$785K LTV'],
      editorial: 'Third year with us. Katherine Ruiz is the mobility lead. Weichert is undercutting us on line-haul by ~8% to try to take a 2026 renewal. Our BAFO is due tomorrow and still has a placeholder on claims handling.',
      dealCount: 5, openValue: '$740K', sinceMonth: 'Oct 2024',
    },
    'acc-2104': {
      kind: 'account', id: 'acc-2104', label: 'Nordlight Capital',
      state: 'inbound',
      meta: ['PE-backed', 'Boston HQ', '12 relos/yr'],
      editorial: 'Intro scheduled. They churned from Sirva after a failed executive move last quarter. Warm referral from MELS. This is winnable with a decent discovery call.',
      dealCount: 0, openValue: '$0', sinceMonth: null,
    },
  },
  deal: {
    'LD-40218': {
      kind: 'deal', id: 'LD-40218', label: 'LD-40218',
      state: 'quote',
      meta: ['SSgt. M. Alvarez', 'Campbell → JBLM', '$2,140'],
      editorial: 'Quote sent Apr 17. Rachel (the spouse) is the decision-maker. Facebook thread Monday surfaced three previous customers recommending us by name.',
    },
    'MSA-2025-041': {
      kind: 'deal', id: 'MSA-2025-041', label: 'MELS · 2026 MSA renewal',
      state: 'bafo',
      meta: ['MELS Corporate Mobility', '$740K', 'Close: Wed'],
      editorial: 'BAFO response due tomorrow. Placeholder on claims-handling section. Weichert\'s counter is pure price — ours has to be about accountability.',
    },
    'LD-40211': {
      kind: 'deal', id: 'LD-40211', label: 'LD-40211',
      state: 'quote',
      meta: ['Capt. R. Wu', 'Benning → Liberty', '$3,880'],
      editorial: 'Delivery window flex requested. Promise logged: recalc by EOD today.',
    },
  },
  base: {
    'rucker': {
      kind: 'base', id: 'rucker', label: 'Fort Rucker',
      state: 'active-cycle',
      meta: ['Alabama', 'Army · aviation', 'OCONUS cycle: Alaska'],
      editorial: 'PCS cycle window opens June 1. Last cycle produced 14 qualified leads. Our partner coverage for Alaska-bound moves is still patchy at the Anchorage port.',
    },
    'campbell': {
      kind: 'base', id: 'campbell', label: 'Fort Campbell',
      state: 'active-cycle',
      meta: ['Kentucky', 'Army · 101st Airborne', 'PCS peak: June'],
      editorial: 'Strong inbound this cycle. Spouses group on Facebook is an active referral channel — three named mentions this week.',
    },
    'liberty': {
      kind: 'base', id: 'liberty', label: 'Fort Liberty',
      state: 'steady',
      meta: ['North Carolina', 'Army · XVIII Airborne Corps'],
      editorial: 'Steady inflow. No cycle peak — constant rotation. Higher proportion of corporate-adjacent spouse moves here.',
    },
  },
  signal: {
    'SIG-00241': {
      kind: 'signal', id: 'SIG-00241', label: 'SIG-00241',
      state: 'p0',
      meta: ['PCS-CYCLE · 4m ago', 'Campbell → JBLM'],
      editorial: 'Fort Campbell enters the 120-day PCS cycle window. Historical: this base generates ~14 qualified leads during a cycle window. Spouses group activity will lead inbound forms by 2–3 weeks.',
    },
    'SIG-00238': {
      kind: 'signal', id: 'SIG-00238', label: 'SIG-00238',
      state: 'p0',
      meta: ['BUYING-SIGNAL · 22m ago', 'CW3 Diane Park'],
      editorial: 'Four opens on the Alaska PCS checklist page. Two mobile, late evening. High-intent research pattern.',
    },
  },
  rep: {
    'm-hall': { alias: 'person:m-hall' },
    'j-brennan': { alias: 'person:j-brennan' },
    'r-hemming': { alias: 'person:r-hemming' },
  },
};

// ─── Verb catalog ───────────────────────────────────────────────────────────
// (nounKind, state, role) → verb[]
// Each verb: { id, label, kbd?, primary?, handler }
// Handlers are no-ops in the prototype but structured so they could dispatch.

interface Verb {
  id: string;
  label: string;
  kbd?: string;
  primary?: boolean;
}

type VerbFn = (role: Role) => Verb[];
type VerbBank = Record<string, VerbFn>;

const VERBS: Record<string, VerbBank> = {
  person: {
    _default: (role: Role) => [
      { id: 'call',    label: 'Call',      kbd: '⌥C', primary: true },
      { id: 'message', label: 'Message',   kbd: '⌥M' },
      { id: 'quote',   label: 'Quote',     kbd: '⌥Q' },
      { id: 'snooze',  label: 'Snooze 2h', kbd: '⌥S' },
      { id: 'open',    label: 'Open ↗',    kbd: '⌥↵' },
    ],
    'in-quote': (role: Role) => [
      { id: 'call',      label: 'Call',         kbd: '⌥C', primary: true },
      { id: 'send-quote',label: 'Resend quote', kbd: '⌥Q' },
      { id: 'recalc',    label: 'Recalc quote', kbd: '⌥R' },
      { id: 'snooze',    label: 'Snooze 2h',    kbd: '⌥S' },
      { id: 'open',      label: 'Open ↗',       kbd: '⌥↵' },
    ],
    'in-bafo': (role: Role) => [
      { id: 'draft-bafo', label: 'Draft BAFO', kbd: '⌥B', primary: true },
      { id: 'call',       label: 'Call',       kbd: '⌥C' },
      { id: 'open',       label: 'Open ↗',     kbd: '⌥↵' },
    ],
    'at-risk': (role: Role) => role === 'mgr' ? [
      { id: 'pair-up',   label: 'Pair up',        kbd: '⌥P', primary: true },
      { id: 'reassign',  label: 'Reassign',       kbd: '⌥R' },
      { id: 'slack',     label: 'Slack',          kbd: '⌥M' },
      { id: 'open',      label: 'Open ↗',         kbd: '⌥↵' },
    ] : [
      { id: 'call',   label: 'Call',   kbd: '⌥C', primary: true },
      { id: 'open',   label: 'Open ↗', kbd: '⌥↵' },
    ],
    'performing': (role: Role) => [
      { id: 'open',     label: 'Open ↗',     kbd: '⌥↵' },
      { id: 'praise',   label: 'Send praise',kbd: '⌥P' },
    ],
    'active-lead': (role: Role) => [
      { id: 'call',    label: 'Call',      kbd: '⌥C', primary: true },
      { id: 'quote',   label: 'Start quote', kbd: '⌥Q' },
      { id: 'snooze',  label: 'Snooze 2h', kbd: '⌥S' },
      { id: 'open',    label: 'Open ↗',    kbd: '⌥↵' },
    ],
  },
  account: {
    _default: (role: Role) => [
      { id: 'open',       label: 'Open ↗',       kbd: '⌥↵', primary: true },
      { id: 'new-deal',   label: 'New deal',     kbd: '⌥N' },
      { id: 'notes',      label: 'Add note',     kbd: '⌥A' },
    ],
    'in-bafo': (role: Role) => [
      { id: 'draft-bafo', label: 'Draft BAFO',   kbd: '⌥B', primary: true },
      { id: 'open',       label: 'Open ↗',       kbd: '⌥↵' },
      { id: 'honest',     label: 'Honest note',  kbd: '⌥H' },
    ],
    'inbound': (role: Role) => [
      { id: 'call',       label: 'Intro call',   kbd: '⌥C', primary: true },
      { id: 'open',       label: 'Open ↗',       kbd: '⌥↵' },
      { id: 'brief',      label: 'Write brief',  kbd: '⌥W' },
    ],
  },
  deal: {
    _default: (role: Role) => [
      { id: 'open',      label: 'Open ↗',     kbd: '⌥↵', primary: true },
      { id: 'advance',   label: 'Advance',    kbd: '⌥A' },
      { id: 'notes',     label: 'Add note',   kbd: '⌥N' },
    ],
    'quote': (role: Role) => [
      { id: 'open',      label: 'Open quote ↗', kbd: '⌥↵', primary: true },
      { id: 'recalc',    label: 'Recalc',       kbd: '⌥R' },
      { id: 'send',      label: 'Resend',       kbd: '⌥S' },
    ],
    'bafo': (role: Role) => [
      { id: 'draft-bafo',label: 'Draft BAFO',  kbd: '⌥B', primary: true },
      { id: 'open',      label: 'Open ↗',      kbd: '⌥↵' },
    ],
  },
  base: {
    _default: (role: Role) => [
      { id: 'open',      label: 'Open ↗',         kbd: '⌥↵', primary: true },
      { id: 'leads',     label: 'See leads',      kbd: '⌥L' },
      { id: 'signals',   label: 'Filter signals', kbd: '⌥S' },
    ],
    'active-cycle': (role: Role) => [
      { id: 'open',      label: 'Open ↗',         kbd: '⌥↵', primary: true },
      { id: 'leads',     label: 'See leads',      kbd: '⌥L' },
      { id: 'signals',   label: 'Filter signals', kbd: '⌥S' },
      { id: 'partner',   label: 'Ask partner',    kbd: '⌥P' },
    ],
  },
  signal: {
    _default: (role: Role) => [
      { id: 'open',      label: 'Open ↗',       kbd: '⌥↵', primary: true },
      { id: 'snooze',    label: 'Snooze',       kbd: '⌥S' },
      { id: 'dismiss',   label: 'Dismiss',      kbd: '⌥X' },
    ],
    'p0': (role: Role) => [
      { id: 'act',       label: 'Take action',  kbd: '⌥↵', primary: true },
      { id: 'open',      label: 'Open ↗',       kbd: '⌥O' },
      { id: 'snooze',    label: 'Snooze',       kbd: '⌥S' },
    ],
  },
  rep: {
    _default: (role: Role) => [
      { id: 'open',     label: 'Open ↗',     kbd: '⌥↵', primary: true },
      { id: 'slack',    label: 'Slack',      kbd: '⌥M' },
    ],
  },
};

function getVerbs(noun: ResolvedNoun | null, role: Role): Verb[] {
  if (!noun) return [];
  const bank: VerbBank = VERBS[noun.kind] || {};
  const state = typeof noun.state === 'string' ? bank[noun.state] : undefined;
  const fn = state || bank._default;
  return fn ? fn(role) : [];
}

type NounRegistry = Record<string, Record<string, ResolvedNoun & { alias?: string }>>;
const TYPED_REGISTRY = NOUN_REGISTRY as unknown as NounRegistry;

// Resolve a noun by "kind:id" or a full noun object
function resolveNoun(ref: NounRefOrKey | null | undefined): ResolvedNoun | null {
  if (!ref) return null;
  if (typeof ref === 'object') return ref as ResolvedNoun;
  const [kind, id] = ref.split(':');
  if (!kind || !id) return null;
  const bank = TYPED_REGISTRY[kind];
  if (!bank) return null;
  let record = bank[id];
  if (record?.alias) {
    const [k2, i2] = record.alias.split(':');
    if (k2 && i2) record = TYPED_REGISTRY[k2]?.[i2];
  }
  return record || null;
}

// ─── useFocus() — global in-focus noun, URL + localStorage sync ────────────
type NounRefOrKey = string | NounRef | ResolvedNoun;

interface FocusContextValue {
  focus: string | null;
  setFocus: (ref: NounRefOrKey | null) => void;
  peekStack: string[];
  pushPeek: (ref: NounRefOrKey) => void;
  popPeek: () => void;
  clearPeek: () => void;
}

const FocusContext = React.createContext<FocusContextValue | null>(null);

function toKey(ref: NounRefOrKey): string {
  return typeof ref === 'string' ? ref : `${ref.kind}:${ref.id}`;
}

function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focus, setFocusRaw] = React.useState<string | null>(() => {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('focus');
    if (fromUrl) return fromUrl;
    return readString('focus');
  });
  const [peekStack, setPeekStack] = React.useState<string[]>(() => {
    const url = new URL(location.href);
    const peek = url.searchParams.get('peek');
    return peek ? peek.split(',') : [];
  });

  const setFocus = React.useCallback((ref: NounRefOrKey | null) => {
    const key = !ref ? null : toKey(ref);
    setFocusRaw(key);
    if (key) writeString('focus', key);
    else removeKey('focus');
    const url = new URL(location.href);
    if (key) url.searchParams.set('focus', key);
    else url.searchParams.delete('focus');
    history.replaceState(null, '', url.toString());
  }, []);

  const pushPeek = React.useCallback((ref: NounRefOrKey) => {
    const key = toKey(ref);
    setPeekStack(s => {
      const next = [...s, key];
      const url = new URL(location.href);
      url.searchParams.set('peek', next.join(','));
      history.replaceState(null, '', url.toString());
      return next;
    });
  }, []);

  const popPeek = React.useCallback(() => {
    setPeekStack(s => {
      const next = s.slice(0, -1);
      const url = new URL(location.href);
      if (next.length) url.searchParams.set('peek', next.join(','));
      else url.searchParams.delete('peek');
      history.replaceState(null, '', url.toString());
      return next;
    });
  }, []);

  const clearPeek = React.useCallback(() => {
    setPeekStack([]);
    const url = new URL(location.href);
    url.searchParams.delete('peek');
    history.replaceState(null, '', url.toString());
  }, []);

  const value = React.useMemo<FocusContextValue>(
    () => ({ focus, setFocus, peekStack, pushPeek, popPeek, clearPeek }),
    [focus, setFocus, peekStack, pushPeek, popPeek, clearPeek]
  );
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

function useFocus(): FocusContextValue {
  const ctx = React.useContext(FocusContext);
  if (!ctx) throw new Error('useFocus must be used within FocusProvider');
  return ctx;
}

// ─── <Noun> — the universal handle ──────────────────────────────────────────
export interface NounProps {
  kind: NounKind;
  id: string;
  children: React.ReactNode;
  as?: React.ElementType;
  className?: string;
  mono?: boolean;
  strong?: boolean;
}

function Noun({ kind, id, children, as: As = 'span', className = '', mono, strong }: NounProps) {
  const Tag = As as React.ElementType;
  const { focus, setFocus, pushPeek } = useFocus();
  const key = `${kind}:${id}`;
  const isFocused = focus === key;

  const activate = (withCmd: boolean) => {
    if (withCmd) setFocus(key);
    pushPeek(key);
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    activate(e.metaKey || e.ctrlKey);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      activate(e.metaKey || e.ctrlKey);
    }
  };

  return (
    <Tag
      className={`noun${isFocused ? ' n-focused' : ''}${mono ? ' n-mono' : ''}${strong ? ' n-strong' : ''} ${className}`}
      data-noun={key}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${kind}: ${typeof children === 'string' ? children : id}`}
    >
      {children}
    </Tag>
  );
}

// ─── Peek drawer — stacked ──────────────────────────────────────────────────
function Peek() {
  const { peekStack, popPeek, clearPeek, setFocus } = useFocus();
  const { role, navigate } = useApp();
  const firstFocusableRef = React.useRef<HTMLButtonElement>(null);
  const lastTriggerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (peekStack.length === 0) return;
    lastTriggerRef.current = document.activeElement as HTMLElement;
    // Focus the first interactive element in the newest panel
    const t = window.setTimeout(() => firstFocusableRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        popPeek();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [peekStack.length, popPeek]);

  React.useEffect(() => {
    if (peekStack.length === 0 && lastTriggerRef.current) {
      lastTriggerRef.current.focus();
      lastTriggerRef.current = null;
    }
  }, [peekStack.length]);

  if (peekStack.length === 0) return null;

  return (
    <>
      <div className="peek-backdrop" onClick={clearPeek}></div>
      {peekStack.map((key, i) => {
        const noun = resolveNoun(key);
        if (!noun) return null;
        const depth = peekStack.length - 1 - i;
        const isTop = i === peekStack.length - 1;
        return (
          <PeekPanel
            key={`${key}-${i}`}
            noun={noun}
            depth={depth}
            isTop={isTop}
            crumbs={peekStack.slice(0, i + 1)}
            onClose={clearPeek}
            onBack={popPeek}
            onDrill={() => { setFocus(noun); clearPeek(); navigate(noun); }}
            role={role}
            firstFocusRef={isTop ? firstFocusableRef : undefined}
          />
        );
      })}
    </>
  );
}

// NOUN_REGISTRY is a polymorphic store — each kind has its own fields. We accept
// loose indexing into the extras because the UI branches on `kind` and `state`.
interface ResolvedNoun {
  kind: NounKind;
  id: string;
  label: string;
  state?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface PeekPanelProps {
  noun: ResolvedNoun;
  depth: number;
  isTop: boolean;
  crumbs: string[];
  onClose: () => void;
  onBack: () => void;
  onDrill: () => void;
  role: Role;
  firstFocusRef?: React.RefObject<HTMLButtonElement>;
}

function PeekPanel({ noun, depth, isTop, crumbs, onClose, onBack, onDrill, role, firstFocusRef }: PeekPanelProps) {
  const verbs = getVerbs(noun, role);
  const rightOffset = depth * 32;
  return (
    <aside
      className={`peek${isTop ? ' peek-top' : ''}`}
      role="dialog"
      aria-modal={isTop ? 'true' : undefined}
      aria-label={`${noun.kind}: ${noun.label}`}
      style={{ right: rightOffset, zIndex: 100 + (10 - depth) }}
    >
      <header className="peek-head">
        <div className="peek-crumbs">
          {crumbs.map((k, i) => {
            const n = resolveNoun(k);
            if (!n) return null;
            const last = i === crumbs.length - 1;
            return (
              <React.Fragment key={k + i}>
                <span className={`pc ${last ? 'current' : ''}`}>{n.kind}</span>
                {!last && <span className="pc-sep">/</span>}
              </React.Fragment>
            );
          })}
        </div>
        <div className="peek-head-right">
          {depth > 0 && (
            <button type="button" className="peek-icon" onClick={onBack} aria-label="Back">
              <ChevronLeft className="ic-sm" aria-hidden="true" />
            </button>
          )}
          <button type="button" className="peek-icon" onClick={onDrill} aria-label="Open full" title="Open full view">
            <Maximize2 className="ic-sm" aria-hidden="true" />
          </button>
          <button type="button" ref={firstFocusRef} className="peek-icon" onClick={onClose} aria-label="Close">
            <X className="ic-sm" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="peek-body">
        <div className="peek-id-row">
          <span className="peek-kind">{noun.kind}</span>
          <span className="peek-id">{noun.id}</span>
          {noun.state && <span className="peek-state">{noun.state}</span>}
        </div>
        <h2 className="peek-title">{noun.label}</h2>
        {noun.role && <div className="peek-role">{noun.role}</div>}
        {noun.meta && (
          <div className="peek-meta">
            {noun.meta.map((m: string, i: number) => <span key={i} className="pm">{m}</span>)}
          </div>
        )}
        {noun.editorial && (
          <div className="peek-editorial">{noun.editorial}</div>
        )}

        {(noun.phone || noun.email) && (
          <div className="peek-kv">
            {noun.phone && <div className="pkv"><span className="k">phone</span><span className="v mono">{noun.phone}</span></div>}
            {noun.email && <div className="pkv"><span className="k">email</span><span className="v mono">{noun.email}</span></div>}
            {noun.account && <div className="pkv"><span className="k">account</span><span className="v"><Noun kind="account" id={noun.account}>{resolveNoun(`account:${noun.account}`)?.label || noun.account}</Noun></span></div>}
            {noun.base && <div className="pkv"><span className="k">base</span><span className="v"><Noun kind="base" id={noun.base}>{resolveNoun(`base:${noun.base}`)?.label || noun.base}</Noun></span></div>}
            {noun.dealId && <div className="pkv"><span className="k">deal</span><span className="v"><Noun kind="deal" id={noun.dealId}>{noun.dealId}</Noun></span></div>}
          </div>
        )}

        {noun.dealCount != null && (
          <div className="peek-kv">
            <div className="pkv"><span className="k">deals · open</span><span className="v mono">{noun.dealCount}</span></div>
            <div className="pkv"><span className="k">open value</span><span className="v mono">{noun.openValue}</span></div>
            {noun.sinceMonth && <div className="pkv"><span className="k">since</span><span className="v mono">{noun.sinceMonth}</span></div>}
          </div>
        )}
      </div>

      <footer className="peek-foot">
        <div className="peek-verbs">
          {verbs.map(v => (
            <button key={v.id} className={`peek-verb${v.primary ? ' primary' : ''}`}>
              <span className="vl">{v.label}</span>
              {v.kbd && <span className="vk">{v.kbd}</span>}
            </button>
          ))}
        </div>
      </footer>
    </aside>
  );
}

// ─── CommandBar — bottom strip ─────────────────────────────────────────────
interface CommandBarProps {
  role: Role;
}

function CommandBar({ role }: CommandBarProps) {
  const { focus, setFocus, pushPeek } = useFocus();
  const { openPalette } = useApp();
  const noun = resolveNoun(focus);
  const verbs = getVerbs(noun, role);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches?.('input,textarea,select')) return;
      if (e.key === 'Escape' && focus) { e.preventDefault(); setFocus(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, setFocus]);

  return (
    <footer className="cmdbar">
      <div className="cmdbar-left">
        {noun ? (
          <>
            <span className="cmd-focus-label">in focus</span>
            <span className="cmd-focus-kind">{noun.kind}</span>
            <button type="button" className="cmd-focus-chip" onClick={() => pushPeek(noun)}>
              <span className="cfc-dot"></span>
              <span className="cfc-label">{noun.label}</span>
              <span className="cfc-id">{noun.id}</span>
            </button>
            <button type="button" className="cmd-focus-clear" onClick={() => setFocus(null)} title="Clear (Esc)" aria-label="Clear focus">
              <X className="ic-sm" aria-hidden="true" />
            </button>
          </>
        ) : (
          <span className="cmd-empty">
            <span className="cmd-empty-k">nothing in focus</span>
            <span className="cmd-empty-v">click any name, id, or base to hold it here</span>
          </span>
        )}
      </div>

      <div className="cmdbar-right">
        {noun && verbs.slice(0, 5).map(v => (
          <button type="button" key={v.id} className={`cmd-verb${v.primary ? ' primary' : ''}`}>
            <span className="vl">{v.label}</span>
            {v.kbd && <span className="vk">{v.kbd}</span>}
          </button>
        ))}
        <button type="button" className="cmd-palette-trigger" onClick={openPalette} aria-label="Open command palette">
          <Command className="ic-sm" aria-hidden="true" />
          <span>⌘K</span>
        </button>
      </div>
    </footer>
  );
}

// ─── CommandPalette — ⌘K ──────────────────────────────────────────────────
interface CommandPaletteProps {
  role: Role;
}

function CommandPalette({ role }: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [selIdx, setSelIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { setFocus, pushPeek, focus } = useFocus();
  const { registerPaletteOpener } = useApp();
  const currentNoun = resolveNoun(focus);

  React.useEffect(() => {
    registerPaletteOpener(() => setOpen(true));
  }, [registerPaletteOpener]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen(o => !o); setQ(''); setSelIdx(0);
      }
      if (open && e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  React.useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Build candidate list: verbs for current noun (if any) + all nouns
  type PaletteItem =
    | { kind: 'verb'; label: string; detail: string; kbd?: string; verb: Verb; noun: ResolvedNoun }
    | { kind: 'noun'; label: string; detail: string; noun: ResolvedNoun };

  const items = React.useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    if (currentNoun) {
      getVerbs(currentNoun, role).forEach(v => {
        list.push({ kind: 'verb', label: `${v.label}`, detail: `${currentNoun.label}`, kbd: v.kbd, verb: v, noun: currentNoun });
      });
    }
    Object.values(TYPED_REGISTRY).forEach(bank => {
      Object.values(bank).forEach(n => {
        if (n.alias) return;
        list.push({ kind: 'noun', label: n.label, detail: `${n.kind} · ${n.id}`, noun: n });
      });
    });
    if (!q) return list;
    const qq = q.toLowerCase();
    return list.filter(it => (it.label + ' ' + (it.detail || '')).toLowerCase().includes(qq));
  }, [q, currentNoun, role]);

  React.useEffect(() => { if (selIdx >= items.length) setSelIdx(0); }, [items.length, selIdx]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(items.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[selIdx];
      if (!it) return;
      if (it.kind === 'noun') { setFocus(it.noun); pushPeek(it.noun); }
      // verb = just close; real app would dispatch
      setOpen(false);
    }
  };

  if (!open) return null;
  return (
    <div className="palette-overlay" onClick={() => setOpen(false)} role="presentation">
      <div className="palette" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="palette-label">
        <div className="palette-input-row">
          <Search className="ic-sm" aria-hidden="true" />
          <label id="palette-label" htmlFor="palette-input" className="sr-only">
            Command palette
          </label>
          <input
            ref={inputRef}
            id="palette-input"
            className="palette-input"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="palette-listbox"
            aria-activedescendant={items[selIdx] ? `palette-item-${selIdx}` : undefined}
            aria-autocomplete="list"
            placeholder={currentNoun ? `Run a verb on ${currentNoun.label}, or find a noun…` : 'Find a noun, run a verb…'}
            value={q}
            onChange={e => { setQ(e.target.value); setSelIdx(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="palette-esc">esc</kbd>
        </div>
        <ul id="palette-listbox" className="palette-results" role="listbox" aria-live="polite">
          {items.slice(0, 12).map((it, i) => (
            <li
              key={i}
              id={`palette-item-${i}`}
              role="option"
              aria-selected={i === selIdx}
              className={`palette-item${i === selIdx ? ' on' : ''}`}
              onMouseEnter={() => setSelIdx(i)}
              onClick={() => {
                if (it.kind === 'noun') { setFocus(it.noun); pushPeek(it.noun); }
                setOpen(false);
              }}
            >
              <span className={`pi-kind ${it.kind}`}>{it.kind === 'verb' ? '▸' : it.noun.kind}</span>
              <span className="pi-label">{it.label}</span>
              <span className="pi-detail">{it.detail}</span>
              {it.kind === 'verb' && it.kbd && <span className="pi-kbd">{it.kbd}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty" role="option" aria-selected="false">No matches</li>}
        </ul>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export { Noun, Peek, CommandBar, CommandPalette, FocusProvider, useFocus, resolveNoun, getVerbs, NOUN_REGISTRY, VERBS };
