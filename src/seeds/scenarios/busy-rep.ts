// Busy-rep scenario: exercises the PromiseStore state machine + the
// Pipeline projection across every status + stage. Target shape:
//
//   Deals: ~30 total across 6 stages, mixed mil/corp/indiv, a handful of
//          hot/warm flags — enough to fill each kanban column with
//          multiple cards.
//
//   Promises: enough variety that the queue surfaces every status —
//     · 8 overdue (spread: 5 min / 30 min / 2 h / 1 d / 3 d ago)
//     · 4 near-escalation (due near-future, escalateAt already passed)
//     · 3 kept (closed out ahead of due)
//     · 3 missed (due passed, not yet escalated)
//     · ~12 healthy future-dated
//
// Intentionally does NOT `extend: ['canonical']` — this is "a different
// rep's view," not additive on top of the default demo. Loading busy-rep
// gives you busy-rep's world, not busy-rep + the 5 canonical promises.

import { CURRENT_SCHEMA_VERSION } from '../runner';
import { scenarioName, type Scenario } from '../types';
import { buildDeal } from '../builders/deal';
import { buildPromise } from '../builders/promise';
import type { StageKey } from '../../lib/types';

const STAGE_MIX: ReadonlyArray<{ stage: StageKey; count: number; kind: 'mil' | 'corp' | 'indiv' }> =
  [
    { stage: 'inbound', count: 5, kind: 'mil' },
    { stage: 'qualify', count: 4, kind: 'mil' },
    { stage: 'qualify', count: 2, kind: 'corp' },
    { stage: 'scoping', count: 4, kind: 'mil' },
    { stage: 'scoping', count: 1, kind: 'indiv' },
    { stage: 'quote', count: 4, kind: 'mil' },
    { stage: 'quote', count: 2, kind: 'corp' },
    { stage: 'verbal', count: 3, kind: 'mil' },
    { stage: 'verbal', count: 1, kind: 'corp' },
    { stage: 'won', count: 3, kind: 'mil' },
    { stage: 'won', count: 1, kind: 'corp' },
  ] as const;

export const busyRepScenario: Scenario = {
  name: scenarioName('busy-rep'),
  schemaVersion: CURRENT_SCHEMA_VERSION,
  defaultRngSeed: 42,
  description:
    'Overloaded rep: ~30 deals across every stage + a promise-status matrix ' +
    '(overdues, near-escalations, kept, missed, healthy) that drives every ' +
    'path through PromiseStore + PromiseTicker.',
  tags: ['rep-role', 'stress', 'overdues', 'escalations'],
  async build(ctx) {
    let dealIdx = 0;

    // Deals: step through the mix, sprinkling hot/warm flags deterministically.
    for (const group of STAGE_MIX) {
      for (let i = 0; i < group.count; i++) {
        const step = `deal-${group.stage}-${dealIdx}`;
        // Hot on every 7th deal, warm on every 11th — deterministic with
        // the RNG that is forked from the seed.
        const hot = ctx.rng.chance(1 / 7);
        const warm = !hot && ctx.rng.chance(1 / 11);
        await buildDeal(ctx, {
          step,
          stage: group.stage,
          kind: group.kind,
          hot,
          warm,
        });
        dealIdx += 1;
      }
    }

    // ─── Promise matrix (exercises every status path) ────────────────────

    // 8 overdue, varied distance-from-now.
    const overdueOffsets = [-5, -30, -60, -120, -60 * 6, -60 * 24, -60 * 48, -60 * 72];
    for (let i = 0; i < overdueOffsets.length; i++) {
      await buildPromise(ctx, {
        step: `promise-overdue-${i}`,
        text: `Follow up on delivery window (overdue ${Math.abs(overdueOffsets[i]!)}m)`,
        noun: { kind: 'person', id: `per_overdue_${i}` },
        dueInMinutes: overdueOffsets[i]!,
      });
    }

    // 4 near-escalation: due soon or recent, but escalateAt already passed
    // so the ticker transitions them to `escalated` on its next pass.
    for (let i = 0; i < 4; i++) {
      await buildPromise(ctx, {
        step: `promise-escalated-${i}`,
        text: `BAFO response (escalation overdue)`,
        noun: { kind: 'account', id: `acc_escalated_${i}` },
        dueInMinutes: -60 - i * 15,
        escalateInMinutes: -5,
      });
    }

    // 3 missed: due passed, no escalation scheduled — ticker marks
    // `missed`.
    for (let i = 0; i < 3; i++) {
      await buildPromise(ctx, {
        step: `promise-missed-${i}`,
        text: `Send TLE paperwork`,
        noun: { kind: 'doc', id: `doc_missed_${i}` },
        dueInMinutes: -60 * (2 + i),
      });
    }

    // 3 kept: created with past dueAt but then kept(); easier path is to
    // create far-future (so ticker won't flip them) and call keep().
    for (let i = 0; i < 3; i++) {
      const id = await buildPromise(ctx, {
        step: `promise-kept-${i}`,
        text: `Call back on rate confirmation`,
        noun: { kind: 'person', id: `per_kept_${i}` },
        dueInMinutes: 60 * 24,
      });
      await ctx.stores.promiseStore.keep(id, 'rep_mhall' as never);
    }

    // ~12 healthy future-dated: fills the "upcoming" view without any
    // overdue drama.
    const healthyOffsets = [
      30,
      60,
      90,
      180,
      360,
      720,
      60 * 24,
      60 * 24 * 2,
      60 * 24 * 3,
      60 * 24 * 5,
      60 * 24 * 7,
      60 * 24 * 10,
    ];
    for (let i = 0; i < healthyOffsets.length; i++) {
      await buildPromise(ctx, {
        step: `promise-healthy-${i}`,
        text: `Intro call / follow-up`,
        noun: { kind: 'person', id: `per_healthy_${i}` },
        dueInMinutes: healthyOffsets[i]!,
      });
    }
  },

  async invariants({ stores, log }) {
    const promises = stores.promiseStore.list();
    const overdue = promises.filter(
      (p) => p.status === 'pending' && new Date(p.dueAt.iso) < new Date()
    ).length;
    const kept = promises.filter((p) => p.status === 'kept').length;
    const escalated = promises.filter((p) => p.status === 'escalated').length;

    // Promise status checks — some conservative bounds, not exact counts,
    // because PromiseTicker may have flipped a few extras by the time
    // invariants run.
    if (promises.length < 25) {
      throw new Error(`busy-rep invariant: expected ≥25 promises total, found ${promises.length}`);
    }
    if (kept < 3) {
      throw new Error(`busy-rep invariant: expected ≥3 kept promises, found ${kept}`);
    }
    if (overdue + escalated < 8) {
      throw new Error(
        `busy-rep invariant: expected ≥8 overdue+escalated, found ${overdue + escalated}`
      );
    }

    // Deal shape checks — should cover every stage.
    const dealEvents = await log.readPrefix('deal:');
    const created = dealEvents.filter((e) => e.payload.kind === 'deal.created');
    const stagesSeen = new Set<string>();
    for (const e of created) {
      if (e.payload.kind === 'deal.created') stagesSeen.add(e.payload.stage);
    }
    if (created.length < 25) {
      throw new Error(`busy-rep invariant: expected ≥25 deals, found ${created.length}`);
    }
    const requiredStages: StageKey[] = ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won'];
    for (const s of requiredStages) {
      if (!stagesSeen.has(s)) {
        throw new Error(`busy-rep invariant: missing stage "${s}" in created deals`);
      }
    }
  },
};
