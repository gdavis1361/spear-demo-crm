// Money — the one true representation of currency in this app.
//
// Stored as a minor-unit bigint + an ISO 4217 currency code. Never a number
// (precision drift), never a display string (lossy). Every value that will be
// summed, compared, or sent over the wire goes through this type.

export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD';

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

// Currencies without decimal subunits (JPY, KRW, VND, etc.)
const ZERO_DECIMAL: ReadonlySet<Currency> = new Set(['JPY']);

function decimalDigits(currency: Currency): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export function money(amountMinor: bigint | number, currency: Currency = 'USD'): Money {
  const n = typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.round(amountMinor));
  return { amountMinor: n, currency };
}

// Construct from a major-unit value (e.g. dollars). Rounds to minor units.
export function moneyFromMajor(major: number, currency: Currency = 'USD'): Money {
  const scale = 10 ** decimalDigits(currency);
  return money(BigInt(Math.round(major * scale)), currency);
}

export function sumMoney(values: readonly Money[]): Money {
  if (values.length === 0) return money(0n, 'USD');
  const currency = values[0].currency;
  let total = 0n;
  for (const v of values) {
    if (v.currency !== currency) {
      throw new Error(`sumMoney: mixed currencies (${currency} vs ${v.currency})`);
    }
    total += v.amountMinor;
  }
  return money(total, currency);
}

export interface FormatOptions {
  /** Render compact: $1.2M, $318K. Default false. */
  compact?: boolean;
  /** Render with sign for positive values. Default false. */
  signed?: boolean;
  /** Locale to format for. Default 'en-US'. */
  locale?: string;
}

export function formatMoney(m: Money, opts: FormatOptions = {}): string {
  const { compact = false, signed = false, locale = 'en-US' } = opts;
  const digits = decimalDigits(m.currency);
  const scale = 10 ** digits;
  const major = Number(m.amountMinor) / scale;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : digits,
    minimumFractionDigits: compact ? 0 : digits,
    signDisplay: signed ? 'always' : 'auto',
  });

  return formatter.format(major);
}

// "$740,000" with thousands separator, no decimals for whole values — the
// house style for this CRM's dashboards. When a fractional part exists,
// render the full subunit precision so "$2,140.50" never appears as
// "$2,140.5".
export function formatMoneyShort(m: Money, locale = 'en-US'): string {
  const digits = decimalDigits(m.currency);
  const major = Number(m.amountMinor) / 10 ** digits;
  const hasFraction = digits > 0 && m.amountMinor % BigInt(10 ** digits) !== 0n;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: hasFraction ? digits : 0,
    minimumFractionDigits: hasFraction ? digits : 0,
  }).format(major);
}
