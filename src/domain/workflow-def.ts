// Workflow definitions — the shape the UI draws and the runner executes.
//
// Every live workflow has an immutable `id` + `version`. Definitions are
// append-only: editing the PCS cycle outreach flow produces a new version.
// In-flight runs stay pinned to their starting version (see `patched()`
// in `workflow-runner.ts`).

import type { RetryPolicy } from './schedules';

export type EventSource =
  | 'milmove.cycle'
  | 'sddc.weekly'
  | 'sam.gov.rfp'
  | 'facebook.spouses'
  | 'quote.expiring'
  | 'manual';

export type ActionVerb =
  | 'email'
  | 'create_task'
  | 'assign_dispatcher'
  | 'add_to_today'
  | 'notify_manager';

/**
 * Terminal labels a *definition* can choose for its `end` step — these
 * are routing-shaped, author-controlled.
 */
export type EndDisposition = 'queued' | 'dropped' | 'handed-off' | 'escalated';

/**
 * Terminal labels that can appear on a `workflow.run_completed` event.
 * Adds `failed` (T9) — reserved for the runner when an activity throws,
 * never authored. Keeping it out of `EndDisposition` stops a definition
 * author from writing `{ kind: 'end', disposition: 'failed' }`; the type
 * system refuses.
 */
export type Disposition = EndDisposition | 'failed';

export type WorkflowStep =
  | { kind: 'trigger'; source: EventSource; label: string }
  | { kind: 'filter'; label: string; predicate: string; expected: string }
  | { kind: 'action'; label: string; verb: ActionVerb; template: string }
  | { kind: 'wait'; label: string; durationMs: number; resumeOn?: readonly string[] }
  | { kind: 'end'; label: string; disposition: EndDisposition };

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  /**
   * Monotonic — bump every time a step is added, removed, or changes
   * semantics. Used by `patched()` to branch live runs safely.
   */
  readonly version: number;
  readonly description: string;
  readonly steps: readonly WorkflowStep[];
  readonly retry: RetryPolicy;
  readonly concurrencyLimit?: number;
}

// ─── Registry ──────────────────────────────────────────────────────────────
// Same data the Workflows screen used to hand-draw — now typed + versioned.

import { DEFAULT_RETRY } from './schedules';

export const PCS_CYCLE_OUTREACH: WorkflowDefinition = {
  id: 'wf-pcs-cycle-outreach',
  name: 'PCS cycle outreach',
  version: 3,
  description:
    'When a base enters its 120-day PCS cycle window, we reach out to families with orders — by name, with their JPPSO coordinator named too. We do not send generic blasts.',
  retry: DEFAULT_RETRY,
  concurrencyLimit: 25,
  steps: [
    { kind: 'trigger', source: 'milmove.cycle', label: 'Base enters 120-day PCS cycle window' },
    {
      kind: 'filter',
      label: 'Has orders on file AND no quote in last 180d',
      predicate: 'has_orders && !recently_quoted',
      expected: 'true',
    },
    {
      kind: 'action',
      label: 'Send "Your PCS checklist" email',
      verb: 'email',
      template: 'pcs.checklist.v2',
    },
    {
      kind: 'wait',
      label: '48 hours · or until reply',
      durationMs: 48 * 60 * 60 * 1000,
      resumeOn: ['inbound.reply'],
    },
    {
      kind: 'action',
      label: 'Assign dispatcher a 30-second look',
      verb: 'create_task',
      template: 'task.triage-30s',
    },
    {
      kind: 'action',
      label: 'Add to Today, rank by report-date',
      verb: 'add_to_today',
      template: 'today.rank-by-date',
    },
    { kind: 'end', label: 'Handed off to rep queue', disposition: 'queued' },
  ],
};

export const OCONUS_PARTNER_GAP: WorkflowDefinition = {
  id: 'wf-oconus-partner-gap',
  name: 'OCONUS quote · partner-gap honesty',
  version: 1,
  description:
    'Named partner gaps get named, not hidden. The rep sees the honest line as part of the quote draft.',
  retry: DEFAULT_RETRY,
  steps: [
    { kind: 'trigger', source: 'quote.expiring', label: 'OCONUS lane with known gap selected' },
    {
      kind: 'filter',
      label: 'Partner coverage incomplete',
      predicate: 'partner_has_gap',
      expected: 'true',
    },
    {
      kind: 'action',
      label: 'Inject honest-note template',
      verb: 'email',
      template: 'quote.partner-gap.v1',
    },
    { kind: 'end', label: 'Draft ready for rep review', disposition: 'handed-off' },
  ],
};

export const QUOTE_EXPIRING: WorkflowDefinition = {
  id: 'wf-quote-expiring',
  name: 'Quote expiring · re-engage',
  version: 2,
  description: 'Quote sits unsigned for 14d → re-engage with updated fuel surcharge.',
  retry: DEFAULT_RETRY,
  steps: [
    { kind: 'trigger', source: 'quote.expiring', label: 'Quote unsigned for 14 days' },
    { kind: 'action', label: 'Send re-quote', verb: 'email', template: 'quote.re-engage.v1' },
    {
      kind: 'wait',
      label: '72 hours for reply',
      durationMs: 72 * 60 * 60 * 1000,
      resumeOn: ['inbound.reply'],
    },
    {
      kind: 'action',
      label: 'Notify manager',
      verb: 'notify_manager',
      template: 'notify.stale-quote',
    },
    { kind: 'end', label: 'Escalated', disposition: 'escalated' },
  ],
};

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  PCS_CYCLE_OUTREACH,
  OCONUS_PARTNER_GAP,
  QUOTE_EXPIRING,
];

export function getWorkflow(id: string): WorkflowDefinition | null {
  return WORKFLOWS.find((w) => w.id === id) ?? null;
}
