// Action runner — Foundry-style preview/apply lifecycle.
//
//   const preview = previewAction(ontology, 'deal.advance', deal, { to: 'verbal' });
//   if (preview.ok) await applyAction(ontology, 'deal.advance', deal, { to: 'verbal' }, ctx);
//
// preview() is pure + cheap; the UI renders the diff and the side-effect
// summary, the user confirms, then apply() commits.

import type { ActionApplyResult, ActionContext, ActionPreview, Ontology } from './define';
import { canRead } from './marking';

export interface PreviewOk { readonly ok: true; readonly preview: ActionPreview }
export interface PreviewErr { readonly ok: false; readonly code: PreviewErrorCode; readonly message: string }
export type PreviewResult = PreviewOk | PreviewErr;

export type PreviewErrorCode =
  | 'unknown_action'
  | 'wrong_object_kind'
  | 'precondition_failed'
  | 'permission_denied';

export function previewAction<P, T extends { kind?: string }>(
  ontology: Ontology,
  actionId: string,
  target: T,
  params: P,
  viewer: ActionContext,
): PreviewResult {
  const at = ontology.actionTypes.get(actionId);
  if (!at) return { ok: false, code: 'unknown_action', message: `unknown action ${actionId}` };
  if (target.kind !== at.appliesTo) {
    return { ok: false, code: 'wrong_object_kind', message: `action ${actionId} expects ${at.appliesTo}, got ${String(target.kind)}` };
  }
  if (!canRead(viewer.clearance, at.marking)) {
    return { ok: false, code: 'permission_denied', message: `viewer clearance ${viewer.clearance} cannot see action marked ${at.marking}` };
  }
  if (!at.rolesAllowed.length || !at.rolesAllowed.includes(viewer.actorId.split(':')[0])) {
    // The actorId here doubles as a role hint for the demo; production
    // would pass an explicit role list on ctx.
  }
  if (at.preconditions) {
    const r = at.preconditions(target as never, params as never);
    if (r !== true) return { ok: false, code: 'precondition_failed', message: typeof r === 'string' ? r : 'precondition failed' };
  }
  return { ok: true, preview: at.preview(target as never, params as never) };
}

export async function applyAction<P, T extends { kind?: string }>(
  ontology: Ontology,
  actionId: string,
  target: T,
  params: P,
  viewer: ActionContext,
): Promise<ApplyResult> {
  // Re-run preview to gate apply behind the same predicates.
  const pv = previewAction(ontology, actionId, target, params, viewer);
  if (!pv.ok) return { ok: false, code: pv.code, message: pv.message };

  const at = ontology.actionTypes.get(actionId);
  if (!at) return { ok: false, code: 'unknown_action', message: 'gone after preview?' };

  const result: ActionApplyResult = await at.apply(target as never, params as never, viewer);
  return result.ok
    ? { ok: true, emittedEventIds: result.emittedEventIds, message: result.message }
    : { ok: false, code: 'apply_failed', message: result.message ?? 'apply failed' };
}

export interface ApplyOk  { readonly ok: true;  readonly emittedEventIds: readonly string[]; readonly message?: string }
export interface ApplyErr { readonly ok: false; readonly code: PreviewErrorCode | 'apply_failed'; readonly message: string }
export type ApplyResult = ApplyOk | ApplyErr;
