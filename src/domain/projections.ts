// Projections — pure folds over event streams. The UI reads these, not
// the raw log. Every projection must be deterministic: same events, same
// output, every time.

import type { StoredEvent, AccountEvent, DealEvent } from './events';
import type { Instant } from '../lib/time';
import type { StageKey } from '../lib/types';

// ─── Account activity feed ─────────────────────────────────────────────────

export interface ActivityItem {
  readonly at: Instant;
  readonly kind: 'Message' | 'File' | 'Signal' | 'Meeting' | 'Claim';
  readonly who: string;
  readonly body: string;
  readonly tag: string;
}

function isAccountEvent(p: StoredEvent['payload']): p is AccountEvent & { stream: StoredEvent['stream'] } {
  return p.kind.startsWith('account.');
}

export function accountActivity(events: readonly StoredEvent[]): readonly ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const e of events) {
    const p = e.payload;
    if (!isAccountEvent(p)) continue;
    switch (p.kind) {
      case 'account.message_received':
        items.push({ at: p.at, kind: 'Message', who: p.from, body: p.body, tag: 'inbound' });
        break;
      case 'account.message_sent':
        items.push({ at: p.at, kind: 'Message', who: p.by, body: p.body, tag: 'outbound' });
        break;
      case 'account.file_uploaded':
        items.push({ at: p.at, kind: 'File', who: p.by, body: `Uploaded ${p.docId} (${p.size} bytes)`, tag: 'file' });
        break;
      case 'account.signal_fired':
        items.push({ at: p.at, kind: 'Signal', who: 'system', body: `Signal ${p.signalId}`, tag: 'signal' });
        break;
      case 'account.meeting_held':
        items.push({ at: p.at, kind: 'Meeting', who: p.attendees.join(', '), body: `${p.durationMin} min`, tag: 'meeting' });
        break;
      case 'account.claim_resolved':
        items.push({ at: p.at, kind: 'Claim', who: 'Claims team', body: `${p.claimId} · resolved in ${Math.round(p.resolvedInMs / 3_600_000)}h`, tag: 'claim' });
        break;
    }
  }
  // Newest first
  return items.sort((a, b) => new Date(b.at.iso).getTime() - new Date(a.at.iso).getTime());
}

// ─── Deal current stage ────────────────────────────────────────────────────

function isDealEvent(p: StoredEvent['payload']): p is DealEvent & { stream: StoredEvent['stream'] } {
  return p.kind.startsWith('deal.');
}

export function dealCurrentStage(events: readonly StoredEvent[]): StageKey | null {
  let stage: StageKey | null = null;
  for (const e of events) {
    const p = e.payload;
    if (!isDealEvent(p)) continue;
    if (p.kind === 'deal.created') stage = p.stage;
    else if (p.kind === 'deal.advanced' || p.kind === 'deal.reverted') stage = p.to;
    else if (p.kind === 'deal.signed') stage = 'won';
  }
  return stage;
}

export interface DealStageChange {
  readonly at: Instant;
  readonly by: string;
  readonly from: StageKey;
  readonly to: StageKey;
  readonly reverted: boolean;
}

export function dealStageHistory(events: readonly StoredEvent[]): readonly DealStageChange[] {
  const out: DealStageChange[] = [];
  for (const e of events) {
    const p = e.payload;
    if (!isDealEvent(p)) continue;
    if (p.kind === 'deal.advanced') out.push({ at: p.at, by: p.by, from: p.from, to: p.to, reverted: false });
    else if (p.kind === 'deal.reverted') out.push({ at: p.at, by: p.by, from: p.from, to: p.to, reverted: true });
  }
  return out;
}
