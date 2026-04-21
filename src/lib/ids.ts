// Branded IDs — compile-time safety on the ~10 kinds of identifier this app
// shuffles around. Prefix contract enforced at construction.
//
// Pattern borrowed from Stripe's dashboard: `cus_…`, `pi_…`, `ch_…`. Wrong
// slot at compile time, wrong prefix at runtime.

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type LeadId      = Brand<string, 'LeadId'>;
export type AccountId   = Brand<string, 'AccountId'>;
export type DealId      = Brand<string, 'DealId'>;
export type MoveId      = Brand<string, 'MoveId'>;
export type SignalId    = Brand<string, 'SignalId'>;
export type PersonId    = Brand<string, 'PersonId'>;
export type BaseId      = Brand<string, 'BaseId'>;
export type DocId       = Brand<string, 'DocId'>;
export type RepId       = Brand<string, 'RepId'>;
export type RequestId   = Brand<string, 'RequestId'>;

const PREFIX = {
  ld: 'LeadId',
  acc: 'AccountId',
  dl: 'DealId',
  mv: 'MoveId',
  sig: 'SignalId',
  per: 'PersonId',
  base: 'BaseId',
  doc: 'DocId',
  rep: 'RepId',
  req: 'RequestId',
} as const;

type PrefixKey = keyof typeof PREFIX;

function check<T>(prefix: PrefixKey, raw: string): T {
  const want = `${prefix}_`;
  if (!raw.startsWith(want)) {
    throw new Error(`[ids] expected ${PREFIX[prefix]} with prefix "${want}", got "${raw}"`);
  }
  return raw as T;
}

export const leadId    = (s: string): LeadId    => check<LeadId>('ld', s);
export const accountId = (s: string): AccountId => check<AccountId>('acc', s);
export const dealId    = (s: string): DealId    => check<DealId>('dl', s);
export const moveId    = (s: string): MoveId    => check<MoveId>('mv', s);
export const signalId  = (s: string): SignalId  => check<SignalId>('sig', s);
export const personId  = (s: string): PersonId  => check<PersonId>('per', s);
export const baseId    = (s: string): BaseId    => check<BaseId>('base', s);
export const docId     = (s: string): DocId     => check<DocId>('doc', s);
export const repId     = (s: string): RepId     => check<RepId>('rep', s);

// Request/trace ID generator. crypto.randomUUID where available, fallback
// otherwise. Callers should treat the value as opaque.
export function newRequestId(): RequestId {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `req_${uuid.replace(/-/g, '').slice(0, 24)}` as RequestId;
}

// Idempotency key: user-generated per side-effecting action, sent on the
// request, safe to retry. Distinct from RequestId (server-generated).
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

// "Legacy" display IDs like "LD-40218", "ACC-1188", "SIG-00241" — the
// external customer-facing string. Normalized to the branded type without
// prefix validation. Use sparingly — prefer the prefixed `ld_…` format.
export function fromDisplayId<T extends string>(s: string): T {
  return s as T;
}
