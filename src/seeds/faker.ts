// Faker-style seeded generators for scenario data. All outputs are
// deterministic given a seeded RNG — the same seed always produces the
// same name, rank, branch, etc. This is what lets busy-rep produce
// "realistic-looking" fixtures that still round-trip through visual
// regression.
//
// Pools are hand-curated to stay true to the demo's milmove/F500 setting.
// Nothing random-in-the-wild: every token is chosen from a small, known
// vocabulary so output diffs are reviewable.

import type { Rng } from './rng';

// ─── Name pools ────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Marcus',
  'Diane',
  'Rohit',
  'Priya',
  'Julian',
  'Keaton',
  'Teresa',
  'Leah',
  'Amir',
  'Beatriz',
  'Chen',
  'Dmitri',
  'Elena',
  'Finn',
  'Gabriela',
  'Hugo',
  'Imani',
  'Juno',
  'Kai',
  'Lena',
] as const;

const LAST_NAMES = [
  'Alvarez',
  'Park',
  'Krishnan',
  'Raman',
  'Soto',
  'Vargas',
  'Whitlock',
  'Moreno',
  'Holt',
  'Oduya',
  'Okafor',
  'Laurent',
  'Pellegrini',
  'Brennan',
  'Okonkwo',
  'Nguyen',
  'Bennett',
  'Castillo',
  'Douglas',
  'Ferrera',
] as const;

// ─── Military ──────────────────────────────────────────────────────────────

const MIL_BRANCHES = ['Army', 'USAF', 'Navy', 'USMC', 'Army Avn', 'SOCOM'] as const;
const MIL_RANKS = [
  'SPC',
  'SSG',
  'SSgt.',
  'MSgt.',
  'CW3',
  'Capt.',
  'Lt. Col.',
  'CDR',
  'Maj.',
  'LT',
] as const;

const PCS_BASES = [
  'Benning',
  'Lewis',
  'Bragg',
  'Campbell',
  'JBLM',
  'Rucker',
  'Wainwright',
  'Coronado',
  'Norfolk',
  'Eglin',
  'Yokota',
  'Mayport',
  'Whidbey',
  'Ramstein',
  'WPAFB',
] as const;

// ─── Corporate / F500 ──────────────────────────────────────────────────────

const CORP_ROOTS = [
  'Brightwell',
  'Nordlight',
  'Redwood',
  'Atlas',
  'Cascade',
  'Orbital',
  'Hartley',
  'Pinecrest',
  'Sable',
  'Beacon',
  'Meridian',
  'Harbor',
  'Summit',
  'Forge',
  'Keystone',
] as const;
const CORP_SUFFIX = [
  'Energy',
  'Capital',
  'Biotech',
  'Federal',
  'Dental Group',
  'Logistics',
  'Holdings',
  'Partners',
] as const;
const CORP_INC = ['Inc.', 'Corp.', 'LLC'] as const;

// ─── Builders ──────────────────────────────────────────────────────────────

export function fakerPersonName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

export interface MilMeta {
  readonly rank: string;
  readonly fullName: string;
  readonly from: string;
  readonly to: string;
  readonly branch: string;
  readonly meta: string;
}

export function fakerMilRelo(rng: Rng): MilMeta {
  const last = rng.pick(LAST_NAMES);
  const first = rng.pick(FIRST_NAMES);
  const rank = rng.pick(MIL_RANKS);
  const from = rng.pick(PCS_BASES);
  let to = rng.pick(PCS_BASES);
  // Avoid same-base no-ops; one retry is enough in practice.
  if (to === from) to = rng.pick(PCS_BASES);
  const branch = rng.pick(MIL_BRANCHES);
  const fullName = `${rank} ${first[0]}. ${last}`;
  return {
    rank,
    fullName,
    from,
    to,
    branch,
    meta: `${from} → ${to} · PCS cycle`,
  };
}

export interface CorpMeta {
  readonly name: string;
  readonly branch: string;
  readonly meta: string;
}

export function fakerCorpAccount(rng: Rng): CorpMeta {
  const root = rng.pick(CORP_ROOTS);
  const suf = rng.pick(CORP_SUFFIX);
  const inc = rng.pick(CORP_INC);
  const employees = rng.intBetween(3, 60);
  const branch = rng.chance(0.4) ? 'F500' : 'SMB';
  return {
    name: `${root} ${suf} ${inc}`,
    branch,
    meta: `Corporate relocations · ${employees}/yr`,
  };
}

export interface IndivMeta {
  readonly fullName: string;
  readonly branch: string;
  readonly meta: string;
}

export function fakerIndivRelo(rng: Rng): IndivMeta {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const from = rng.pick(PCS_BASES);
  let to = rng.pick(PCS_BASES);
  if (to === from) to = rng.pick(PCS_BASES);
  return {
    fullName: `${first} ${last}`,
    branch: 'Civ',
    meta: `${from} → ${to} · individual full-service`,
  };
}

/** Pick N distinct integer ids from a large space so collisions are rare. */
export function fakerDisplayId(rng: Rng, prefix: 'LD' | 'ACC', low = 40000, high = 49999): string {
  return `${prefix}-${rng.intBetween(low, high)}`;
}
