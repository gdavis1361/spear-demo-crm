import { describe, it, expect } from 'vitest';
import { money, moneyFromMajor, sumMoney, formatMoney, formatMoneyShort } from './money';

describe('money()', () => {
  it('accepts a bigint amountMinor', () => {
    const m = money(100n, 'USD');
    expect(m.amountMinor).toBe(100n);
    expect(m.currency).toBe('USD');
  });

  it('rounds a number amountMinor to the nearest integer', () => {
    expect(money(99.4, 'USD').amountMinor).toBe(99n);
    expect(money(99.5, 'USD').amountMinor).toBe(100n);
    expect(money(-99.6, 'USD').amountMinor).toBe(-100n);
  });

  it('defaults to USD when currency omitted', () => {
    expect(money(1n).currency).toBe('USD');
  });
});

describe('moneyFromMajor()', () => {
  const cases: Array<[number, string, bigint]> = [
    [1, 'USD', 100n],
    [1.5, 'USD', 150n],
    [0.01, 'USD', 1n],
    [0.001, 'USD', 0n], // below subunit precision — rounds to zero
    [1000000, 'USD', 100_000_000n],
    [1, 'JPY', 1n], // JPY has zero decimals
    [1234, 'JPY', 1234n],
    [0, 'USD', 0n],
    [-42.5, 'USD', -4250n],
  ];

  it.each(cases)('major=%s %s → minor=%s', (major, currency, expected) => {
    expect(moneyFromMajor(major, currency as 'USD' | 'JPY').amountMinor).toBe(expected);
  });

  it('survives bignum-scale values without precision drift', () => {
    // $9 trillion in USD minor = 900_000_000_000_000n, too big for number
    const m = moneyFromMajor(9_000_000_000_000, 'USD');
    expect(m.amountMinor).toBe(900_000_000_000_000n);
  });
});

describe('sumMoney()', () => {
  it('returns zero USD on empty input', () => {
    expect(sumMoney([]).amountMinor).toBe(0n);
    expect(sumMoney([]).currency).toBe('USD');
  });

  it('sums matching-currency values exactly', () => {
    const total = sumMoney([
      moneyFromMajor(10.01, 'USD'),
      moneyFromMajor(20.02, 'USD'),
      moneyFromMajor(30.03, 'USD'),
    ]);
    expect(total.amountMinor).toBe(6006n);
  });

  it('handles large sums without precision drift', () => {
    const hundredK = Array.from({ length: 100_000 }, () => moneyFromMajor(0.01, 'USD'));
    expect(sumMoney(hundredK).amountMinor).toBe(100_000n); // $1,000 exactly
  });

  it('throws on mixed currencies', () => {
    expect(() =>
      sumMoney([moneyFromMajor(1, 'USD'), moneyFromMajor(1, 'EUR')])
    ).toThrow(/mixed currencies/);
  });
});

describe('formatMoney()', () => {
  it('formats USD standard (en-US)', () => {
    expect(formatMoney(moneyFromMajor(1234.56, 'USD'))).toBe('$1,234.56');
  });

  it('formats USD compact', () => {
    expect(formatMoney(moneyFromMajor(1_200_000, 'USD'), { compact: true })).toBe('$1.2M');
    expect(formatMoney(moneyFromMajor(740_000, 'USD'), { compact: true })).toBe('$740K');
  });

  it('formats JPY without decimals', () => {
    expect(formatMoney(money(1234n, 'JPY'))).toBe('¥1,234');
  });

  it('honors signed option for positive values', () => {
    expect(formatMoney(moneyFromMajor(10, 'USD'), { signed: true })).toBe('+$10.00');
  });

  it('formats zero cleanly', () => {
    expect(formatMoney(moneyFromMajor(0, 'USD'))).toBe('$0.00');
  });

  it('respects locale', () => {
    // en-GB uses GBP and thousands separators
    const gbp = moneyFromMajor(1234.56, 'GBP');
    expect(formatMoney(gbp, { locale: 'en-GB' })).toBe('£1,234.56');
  });
});

describe('formatMoneyShort()', () => {
  it('drops trailing zeros on whole-dollar values', () => {
    expect(formatMoneyShort(moneyFromMajor(740_000, 'USD'))).toBe('$740,000');
  });

  it('keeps decimals when the value has a fractional part', () => {
    expect(formatMoneyShort(moneyFromMajor(2_140.50, 'USD'))).toBe('$2,140.50');
  });

  it('handles JPY as integer', () => {
    expect(formatMoneyShort(money(5000n, 'JPY'))).toBe('¥5,000');
  });
});
