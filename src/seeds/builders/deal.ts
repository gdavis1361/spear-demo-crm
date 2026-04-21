// Deal builder — emits a `deal.created` event through the provided
// EventLog. Scenarios pass in the RNG, clock, and step-name (for opKey
// derivation); the builder shapes a realistic payload out of the faker
// pool.
//
// Idempotency: every call sets `AppendInput.opKey` to the scenario's
// `ctx.opKey(step)`, which is a pure function of (rngSeed, layer, step).
// Re-running the scenario with the same seed is a UNIQUE-index dedupe
// via existing event-log semantics.

import type { ScenarioCtx } from '../types';
import { dealStream } from '../../domain/events';
import { repId, leadId, accountId, type LeadId, type AccountId } from '../../lib/ids';
import { moneyFromMajor } from '../../lib/money';
import type { StageKey } from '../../lib/types';
import type { Money } from '../../lib/money';
import { fakerMilRelo, fakerCorpAccount, fakerIndivRelo, fakerDisplayId } from '../faker';
import type { Rng } from '../rng';

/** Narrowed opts for a Deal builder call. */
export interface BuildDealOptions {
  /**
   * Stable human-readable step name for opKey derivation. Include something
   * that distinguishes this deal from its siblings in the same scenario
   * (e.g. the sequence index). Scenarios that create many deals should
   * pass `step: \`deal-\${i}\``.
   */
  readonly step: string;
  readonly stage: StageKey;
  /** Shape/persona; drives which faker template runs. Default: 'mil'. */
  readonly kind?: 'mil' | 'corp' | 'indiv';
  /** Override value; default derived from kind. */
  readonly value?: Money;
  readonly hot?: boolean;
  readonly warm?: boolean;
  /** Explicit id override; default auto-derived from ctx.opKey. */
  readonly id?: LeadId | AccountId;
}

export interface BuiltDeal {
  readonly id: LeadId | AccountId;
  readonly displayId: string;
  readonly title: string;
}

export async function buildDeal(ctx: ScenarioCtx, opts: BuildDealOptions): Promise<BuiltDeal> {
  const { step, stage, kind = 'mil', hot, warm } = opts;
  const by = repId('rep_mhall');
  const at = { iso: ctx.clock.nowIso() };
  const opKey = ctx.opKey(step);

  const spec = buildSpec(ctx.rng, kind);
  const displayId = opts.id !== undefined ? derivedDisplayId(opts.id) : spec.displayId;
  const dealId: LeadId | AccountId =
    opts.id !== undefined
      ? opts.id
      : kind === 'corp'
        ? accountId(`acc_${opKey.slice(0, 6)}`)
        : leadId(`ld_${opKey.slice(0, 6)}`);
  const value = opts.value ?? spec.value;

  const tags = buildTags(kind, { hot, warm });

  await ctx.log.append(dealStream(dealId), [
    {
      opKey,
      payload: {
        kind: 'deal.created',
        at,
        by,
        stage,
        value,
        displayId,
        title: spec.title,
        meta: spec.meta,
        branch: spec.branch,
        tags,
        ...(hot !== undefined ? { hot } : {}),
        ...(warm !== undefined ? { warm } : {}),
      },
    },
  ]);

  return { id: dealId, displayId, title: spec.title };
}

interface Spec {
  readonly title: string;
  readonly meta: string;
  readonly branch: string;
  readonly value: Money;
  readonly displayId: string;
}

function buildSpec(rng: Rng, kind: 'mil' | 'corp' | 'indiv'): Spec {
  if (kind === 'mil') {
    const m = fakerMilRelo(rng);
    return {
      title: m.fullName,
      meta: m.meta,
      branch: m.branch,
      value: moneyFromMajor(rng.intBetween(1200, 9500), 'USD'),
      displayId: fakerDisplayId(rng, 'LD'),
    };
  }
  if (kind === 'corp') {
    const c = fakerCorpAccount(rng);
    return {
      title: c.name,
      meta: c.meta,
      branch: c.branch,
      value: moneyFromMajor(rng.intBetween(40_000, 900_000), 'USD'),
      displayId: fakerDisplayId(rng, 'ACC', 1000, 9999),
    };
  }
  const i = fakerIndivRelo(rng);
  return {
    title: i.fullName,
    meta: i.meta,
    branch: i.branch,
    value: moneyFromMajor(rng.intBetween(1800, 8400), 'USD'),
    displayId: fakerDisplayId(rng, 'LD'),
  };
}

function buildTags(
  kind: 'mil' | 'corp' | 'indiv',
  flags: { hot?: boolean; warm?: boolean }
): string[] {
  const tags: string[] = [];
  if (kind === 'mil') tags.push('PCS');
  if (kind === 'corp') tags.push('CORP');
  if (kind === 'indiv') tags.push('INDIV');
  if (flags.warm) tags.push('EXPIRED');
  return tags;
}

function derivedDisplayId(id: LeadId | AccountId): string {
  const raw = String(id);
  // 'ld_40218' → 'LD-40218', 'acc_1188' → 'ACC-1188'
  const [prefix, rest] = raw.split('_');
  return `${(prefix ?? '').toUpperCase()}-${rest ?? raw}`;
}
