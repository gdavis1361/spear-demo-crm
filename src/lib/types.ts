import type { ReactNode } from 'react';
import type { Money } from './money';
// Only the brands used *inline* below. The re-export surface at the
// bottom of this file pulls the full set directly from './ids' — this
// import and that re-export are intentionally NOT the same binding,
// so adding a new brand to ids.ts doesn't silently land an unused
// import here the next time someone adds a file-wide type alias.
import type { LeadId, AccountId } from './ids';
import type { DerivedValue } from '../ontology/lineage';

export type Screen = 'today' | 'pipeline' | 'pond' | 'signals' | 'account' | 'quote' | 'workflows';
export type Role = 'rep' | 'ae' | 'mgr';

export type NounKind =
  | 'person'
  | 'account'
  | 'deal'
  | 'base'
  | 'signal'
  | 'doc'
  | 'promise'
  | 'rep'
  | 'lane'
  | 'competitor';

export interface NounRef {
  kind: NounKind;
  id: string;
}

export interface TodayCardMeta {
  t: string;
  accent: boolean;
}

export interface TodayCard {
  rank: number;
  now: boolean;
  name: string;
  /** Display ID (e.g. "LD-40218"); the typed id lives in `idNoun`. */
  id: string;
  noun?: NounRef;
  idNoun?: NounRef;
  kind: 'PCS' | 'CORP' | 'GSA' | 'INDIV';
  branch: string;
  base: string;
  why: string;
  context: ReactNode;
  meta: TodayCardMeta[];
  /**
   * The "spear-score" the rep sees on the queue card. Carries lineage
   * back to the contributing signals + features so operators can audit
   * why this lead is ranked where it is.
   */
  score: DerivedValue<number>;
}

export interface PromiseItem {
  t: string;
  when: string;
  cls: 'soon' | 'overdue' | '';
}

export type StageKey = 'inbound' | 'qualify' | 'scoping' | 'quote' | 'verbal' | 'won';

export interface Stage {
  k: StageKey;
  label: string;
  color: string;
  count: number;
  value: Money;
}

export interface Deal {
  stage: StageKey;
  /** Branded ID (LeadId or AccountId) — matches the stable identifier shown in the UI. */
  dealId: LeadId | AccountId;
  /** Display ID — human-facing. */
  displayId: string;
  title: string;
  meta: string;
  branch: string;
  value: Money;
  tags: string[];
  hot?: boolean;
  warm?: boolean;
}

export interface LeaderboardRow {
  pos: string;
  n: string;
  pod: string;
  val: Money;
  delta: string;
  cls: 'up' | 'down' | '';
}

export type Ground = 'graphite' | 'paper';
export type PipeLayout = 'kanban' | 'timeline' | 'table';
export type Density = 'comfortable' | 'compact';
export type TodaySort = 'priority' | 'stage';

export interface Tweaks {
  ground: Ground;
  pipeLayout: PipeLayout;
  density: Density;
  todaySort: TodaySort;
}

// Re-export primitives so callers have a single import site.
export type { Money, Currency } from './money';
export type { Instant, ZonedDateTime, IanaZone } from './time';
export type {
  LeadId,
  AccountId,
  DealId,
  MoveId,
  SignalId,
  PersonId,
  BaseId,
  DocId,
  RepId,
  RequestId,
} from './ids';
export type { PhoneNumber, EmailAddress } from './contact';
