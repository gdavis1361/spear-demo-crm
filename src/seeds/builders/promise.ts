// Promise builder — creates a DurablePromise via PromiseStore. Uses
// ctx.opKey(step) as the stable id so re-runs dedupe.

import type { ScenarioCtx } from '../types';
import { repId, type RepId } from '../../lib/ids';
import type { NounRef } from '../../lib/types';
import { instant } from '../../lib/time';

export interface BuildPromiseOptions {
  readonly step: string;
  readonly text: string;
  readonly noun: NounRef;
  /** Minutes from ctx.clock.now(). Negative = overdue. */
  readonly dueInMinutes: number;
  /** Optional escalation offset in minutes. Negative = escalate past due. */
  readonly escalateInMinutes?: number;
  readonly createdBy?: RepId;
}

export async function buildPromise(ctx: ScenarioCtx, opts: BuildPromiseOptions): Promise<string> {
  const id = `pr_${ctx.opKey(opts.step).slice(0, 10)}`;
  const dueAt = instant(ctx.clock.minutesFromNow(opts.dueInMinutes).toISOString());
  const escalateAt =
    opts.escalateInMinutes !== undefined
      ? instant(ctx.clock.minutesFromNow(opts.escalateInMinutes).toISOString())
      : undefined;
  await ctx.stores.promiseStore.create({
    id,
    noun: opts.noun,
    text: opts.text,
    dueAt,
    ...(escalateAt ? { escalateAt } : {}),
    createdBy: opts.createdBy ?? repId('rep_mhall'),
  });
  return id;
}
