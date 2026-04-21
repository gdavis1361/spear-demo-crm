// Typed mutations — the complete surface that the UI hits. Each returns a
// Result<T>, takes an optional idempotency key, and is safe to retry.

import { api } from './client';
import type { Result } from './types';
import type { DealId, LeadId, AccountId, SignalId } from '../lib/ids';
import type { StageKey } from '../lib/types';

export interface DealSnapshot { ok: true; stage: StageKey }
export interface DismissedAck { ok: true; dismissedAt: string }
export interface ActionedAck  { ok: true; actionedAt: string }
export interface SentAck      { ok: true; sentAt: string }

export function advanceDeal(
  id: DealId | LeadId | AccountId,
  stage: StageKey,
  idempotencyKey?: string
): Promise<Result<DealSnapshot>> {
  return api.patch(`/deals/${id}`, { stage }, { idempotencyKey });
}

export function dismissSignal(
  id: SignalId,
  reason?: string,
  idempotencyKey?: string
): Promise<Result<DismissedAck>> {
  return api.post(`/signals/${id}/dismiss`, { reason }, { idempotencyKey });
}

export function actionSignal(
  id: SignalId,
  idempotencyKey?: string
): Promise<Result<ActionedAck>> {
  return api.post(`/signals/${id}/action`, {}, { idempotencyKey });
}

export function sendBafoQuote(
  id: DealId | LeadId | AccountId,
  text: string,
  idempotencyKey?: string
): Promise<Result<SentAck>> {
  return api.post(`/quotes/${id}/send`, { text }, { idempotencyKey });
}
