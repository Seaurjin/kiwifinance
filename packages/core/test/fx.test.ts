import { describe, expect, it } from 'vitest';
import {
  baseAmount,
  convert,
  freezeConversion,
  fxRate,
  FxRateMismatchError,
  identityRate,
  invertRate,
  isForeign,
  money,
  originalAmount,
} from '@kiwi/core';

const jpyToSgd = fxRate({ from: 'JPY', to: 'SGD', rate: 0.009, source: 'card_statement', asOf: '2026-03-08' });
const cnyToSgd = fxRate({ from: 'CNY', to: 'SGD', rate: 0.186, source: 'card_statement', asOf: '2026-03-11' });

describe('rate construction', () => {
  it('rejects a non-positive rate', () => {
    expect(() => fxRate({ ...jpyToSgd, rate: 0 })).toThrow(RangeError);
    expect(() => fxRate({ ...jpyToSgd, rate: -1 })).toThrow(RangeError);
  });

  it('rejects a rate without a proper date, since the date is its provenance', () => {
    expect(() => fxRate({ ...jpyToSgd, asOf: '8 March' })).toThrow(TypeError);
  });
});

describe('convert', () => {
  it('crosses currencies with different minor units correctly', () => {
    // 30,000 JPY (no minor unit) at 0.0090 is 270.00 SGD.
    expect(convert(money(-30_000, 'JPY'), jpyToSgd)).toEqual({
      amountMinor: -27_000,
      currency: 'SGD',
    });
  });

  it('converts within the usual two-decimal case', () => {
    // 210.00 CNY at 0.1860 is 39.06 SGD.
    expect(convert(money(-21_000, 'CNY'), cnyToSgd).amountMinor).toBe(-3_906);
  });

  it('is a no-op when the rate is an identity', () => {
    const rate = identityRate('SGD', '2026-03-01');
    expect(convert(money(4_500, 'SGD'), rate).amountMinor).toBe(4_500);
  });

  it('refuses a rate that does not start from the amount currency', () => {
    expect(() => convert(money(100, 'USD'), jpyToSgd)).toThrow(FxRateMismatchError);
  });

  it('is deterministic — the same inputs always give the same minor units', () => {
    const first = convert(money(-12_345, 'CNY'), cnyToSgd);
    const second = convert(money(-12_345, 'CNY'), cnyToSgd);
    expect(first).toEqual(second);
  });
});

describe('invertRate', () => {
  it('flips direction and keeps provenance', () => {
    const back = invertRate(cnyToSgd);
    expect(back.from).toBe('SGD');
    expect(back.to).toBe('CNY');
    expect(back.source).toBe('card_statement');
    expect(back.asOf).toBe('2026-03-11');
    expect(back.rate).toBeCloseTo(1 / 0.186, 10);
  });
});

describe('freezeConversion', () => {
  const frozen = freezeConversion(money(-30_000, 'JPY'), jpyToSgd);

  it('stores the original amount, the rate, its source and the converted amount', () => {
    expect(frozen).toEqual({
      amountMinor: -30_000,
      currency: 'JPY',
      fxRate: 0.009,
      fxRateSource: 'card_statement',
      fxAsOf: '2026-03-08',
      baseAmountMinor: -27_000,
      baseCurrency: 'SGD',
    });
  });

  it('reads back without recomputing anything', () => {
    expect(baseAmount(frozen)).toEqual({ amountMinor: -27_000, currency: 'SGD' });
    expect(originalAmount(frozen)).toEqual({ amountMinor: -30_000, currency: 'JPY' });
    expect(isForeign(frozen)).toBe(true);
  });

  it('survives a later rate change — that is the whole point of freezing', () => {
    const laterRate = fxRate({ ...jpyToSgd, rate: 0.011, asOf: '2027-01-01' });
    const recomputedToday = convert(money(-30_000, 'JPY'), laterRate);

    // The market moved, so a fresh conversion differs...
    expect(recomputedToday.amountMinor).toBe(-33_000);
    // ...but what was written in March still reads as it did in March.
    expect(frozen.baseAmountMinor).toBe(-27_000);
  });
});
