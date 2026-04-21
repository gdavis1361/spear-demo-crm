// The Spear ontology.
//
// One declaration. Forms, projections, ObjectSet queries, the action
// preview UI, and the (eventual) AIP agent all read from it. Adding a
// new object type is one declaration; adding a property is one line.

import { defineOntology, type ActionTypeDefinition } from './define';
import {
  stringProp,
  enumProp,
  moneyProp,
  instantProp,
  integerProp,
  emailProp,
  phoneProp,
  brandedIdProp,
} from './property-types';
import { canTransition } from '../domain/deal-machine';
import type { StageKey } from '../lib/types';

// ─── Action declarations ───────────────────────────────────────────────────
// Each Verb in the legacy `VERBS` registry becomes a typed ActionType with
// preconditions, preview, and apply. The UI's existing handlers can call
// `apply()` on these directly.
//
// VX9 reconciliation: these `apply` functions are preview-only stubs.
// Real mutations run through the durable outbox — see
// `src/domain/outbox.ts` and `src/domain/outbox-dispatchers.ts`. The
// ontology layer owns metadata (diff, side-effect description, role
// gating, marking); the outbox layer owns "does this actually reach
// the server, reliably." Wiring `apply` to call `outbox.enqueue(...)`
// for each corresponding `OutboxMutation` is the next step when
// generic-ontology-driven actions become a product requirement — until
// then, the Pipeline/Signals screens call the outbox directly.

interface DealSnapshot {
  stage: StageKey;
  title: string;
  value: { amountMinor: bigint; currency: string };
}

const advanceDealAction: ActionTypeDefinition<{ to: StageKey }, DealSnapshot> = {
  id: 'deal.advance',
  label: 'Advance stage',
  appliesTo: 'deal',
  rolesAllowed: ['rep', 'ae', 'mgr'],
  marking: 'low',
  preconditions: (deal, params) =>
    canTransition(deal.stage, params.to) || `Illegal transition ${deal.stage} → ${params.to}`,
  preview: (deal, params) => ({
    diff: { stage: { from: deal.stage, to: params.to } },
    sideEffects: [
      `Emit deal.advanced event (${deal.stage} → ${params.to})`,
      `Notify owner via in-app digest`,
      params.to === 'won' ? 'Trigger contract draft pipeline' : '',
    ].filter(Boolean) as string[],
  }),
  apply: async (_deal, _params, _ctx) => {
    // The real apply is wired in the pipeline screen; this stub keeps
    // the ontology self-contained for tests + previews.
    return { ok: true, emittedEventIds: [] };
  },
};

const sendBafoAction: ActionTypeDefinition<{ text: string }, DealSnapshot> = {
  id: 'deal.send_bafo',
  label: 'Send BAFO',
  appliesTo: 'deal',
  rolesAllowed: ['ae', 'mgr'],
  marking: 'high', // BAFO drafts are sensitive
  preconditions: (deal) => deal.stage === 'quote' || `Cannot send BAFO from stage ${deal.stage}`,
  preview: (_deal, params) => ({
    diff: {},
    sideEffects: [
      `Send BAFO email to shipper (${params.text.length} chars)`,
      'Register 7-day expiration timer',
      'Emit deal.quote_sent event',
    ],
  }),
  apply: async () => ({ ok: true, emittedEventIds: [] }),
};

const dismissSignalAction: ActionTypeDefinition<{ reason?: string }, { id: string }> = {
  id: 'signal.dismiss',
  label: 'Dismiss',
  appliesTo: 'signal',
  rolesAllowed: ['rep', 'ae', 'mgr'],
  marking: 'low',
  preview: (sig, params) => ({
    diff: { dismissed: { from: false, to: true } },
    sideEffects: [`Mark signal ${sig.id} dismissed${params.reason ? ` · "${params.reason}"` : ''}`],
  }),
  apply: async () => ({ ok: true, emittedEventIds: [] }),
};

// ─── Object types ──────────────────────────────────────────────────────────

export const ontology = defineOntology({
  objectTypes: [
    {
      kind: 'person',
      label: 'Person',
      primaryKey: 'id',
      marking: 'medium', // PII
      properties: {
        id: brandedIdProp({ label: 'ID', marking: 'low', sortable: true }),
        label: stringProp({ label: 'Name', marking: 'medium', searchable: true, sortable: true }),
        role: stringProp({ label: 'Role', marking: 'medium', searchable: true }),
        phone: phoneProp({ label: 'Phone', marking: 'high' }),
        email: emailProp({ label: 'Email', marking: 'high', searchable: true }),
      },
      links: {
        base: { to: 'base', cardinality: 'one', inverse: 'persons' },
        account: { to: 'account', cardinality: 'one', inverse: 'persons' },
        deal: { to: 'deal', cardinality: 'one', inverse: 'primaryContact' },
      },
      actions: [],
    },
    {
      kind: 'account',
      label: 'Account',
      primaryKey: 'id',
      marking: 'medium',
      properties: {
        id: brandedIdProp({ label: 'ID', marking: 'low', sortable: true }),
        label: stringProp({ label: 'Name', marking: 'low', searchable: true, sortable: true }),
        dealCount: integerProp({ label: 'Open deals', marking: 'low', sortable: true }),
        openValue: moneyProp({ label: 'Open value', marking: 'medium', sortable: true }),
        sinceMonth: stringProp({ label: 'Since', marking: 'low', sortable: true }),
        editorial: stringProp({ label: 'Editorial', marking: 'medium' }),
      },
      links: {
        persons: { to: 'person', cardinality: 'many', inverse: 'account' },
        deals: { to: 'deal', cardinality: 'many', inverse: 'account' },
      },
      actions: [],
    },
    {
      kind: 'deal',
      label: 'Deal',
      primaryKey: 'dealId',
      marking: 'medium',
      properties: {
        dealId: brandedIdProp({ label: 'ID', marking: 'low', sortable: true }),
        displayId: stringProp({
          label: 'Display ID',
          marking: 'low',
          searchable: true,
          sortable: true,
        }),
        title: stringProp({ label: 'Title', marking: 'low', searchable: true, sortable: true }),
        meta: stringProp({ label: 'Description', marking: 'low' }),
        branch: stringProp({ label: 'Branch', marking: 'low', sortable: true }),
        stage: enumProp({
          label: 'Stage',
          marking: 'low',
          sortable: true,
          values: ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won'],
        }),
        value: moneyProp({ label: 'Value', marking: 'medium', sortable: true }),
        bafoDraft: stringProp({ label: 'BAFO draft', marking: 'high' }),
      },
      links: {
        account: { to: 'account', cardinality: 'one', inverse: 'deals' },
        primaryContact: { to: 'person', cardinality: 'one', inverse: 'deal' },
        signals: { to: 'signal', cardinality: 'many', inverse: 'deal' },
      },
      actions: ['deal.advance', 'deal.send_bafo'],
    },
    {
      kind: 'base',
      label: 'Military base',
      primaryKey: 'id',
      marking: 'low',
      properties: {
        id: brandedIdProp({ label: 'ID', marking: 'low' }),
        label: stringProp({ label: 'Name', marking: 'low', searchable: true, sortable: true }),
        editorial: stringProp({ label: 'Notes', marking: 'low' }),
      },
      links: {
        persons: { to: 'person', cardinality: 'many', inverse: 'base' },
      },
    },
    {
      kind: 'signal',
      label: 'Signal',
      primaryKey: 'id',
      marking: 'medium',
      properties: {
        id: brandedIdProp({ label: 'ID', marking: 'low', sortable: true }),
        priority: enumProp({
          label: 'Priority',
          marking: 'low',
          sortable: true,
          values: ['p0', 'p1', 'p2'],
        }),
        kind: stringProp({ label: 'Kind', marking: 'low', searchable: true, sortable: true }),
        headline: stringProp({ label: 'Headline', marking: 'medium', searchable: true }),
        body: stringProp({ label: 'Detail', marking: 'medium' }),
        actor: stringProp({ label: 'Source', marking: 'low' }),
        age: stringProp({ label: 'Age', marking: 'low', sortable: true }),
      },
      links: {
        deal: { to: 'deal', cardinality: 'one', inverse: 'signals' },
        account: { to: 'account', cardinality: 'one', inverse: 'signals' },
        base: { to: 'base', cardinality: 'one', inverse: 'signals' },
      },
      actions: ['signal.dismiss'],
    },
    {
      kind: 'promise',
      label: 'Promise',
      primaryKey: 'id',
      marking: 'low',
      properties: {
        id: brandedIdProp({ label: 'ID', marking: 'low' }),
        text: stringProp({ label: 'Promise', marking: 'low', searchable: true }),
        dueAt: instantProp({ label: 'Due', marking: 'low', sortable: true }),
        escalateAt: instantProp({ label: 'Escalate at', marking: 'low' }),
        status: enumProp({
          label: 'Status',
          marking: 'low',
          sortable: true,
          values: ['pending', 'kept', 'missed', 'escalated'],
        }),
        createdAt: instantProp({ label: 'Created', marking: 'low', sortable: true }),
        updatedAt: instantProp({ label: 'Updated', marking: 'low', sortable: true }),
      },
    },
  ],
  actionTypes: [
    advanceDealAction as ActionTypeDefinition,
    sendBafoAction as ActionTypeDefinition,
    dismissSignalAction as ActionTypeDefinition,
  ],
});

// Re-export for tests + UI.
export type { Ontology, ObjectTypeDefinition, ActionTypeDefinition } from './define';
