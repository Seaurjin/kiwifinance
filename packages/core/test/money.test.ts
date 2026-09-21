import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  CurrencyMismatchError,
  formatMoney,
  fromMajor,
  minorUnitExponent,
  money,
  multiply,
  ratio,
  round,
  subtract,
  sum,
  toMajor,
} from '@kiwi/core';

describe('currency minor units', () => {
  it('knows that JPY has no minor unit and KWD has three', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('rejects anything that is not a three-letter code', () => {
    expect(() => minorUnitExponent('usd')).toThrow(TypeError);
    expect(() => minorUnitExponent('DOLLAR')).toThrow(TypeError);
  });
});

describe('money construction', () => {
  it('refuses a non-integer amount, because that is how cents go missing', () => {
    expect(() => money(12.5, 'USD')).toThrow(TypeError);
  });

  it('converts major units using the currency exponent, not a constant 100', () => {
    expect(fromMajor(12.34, 'USD').amountMinor).toBe(1234);
    expect(fromMajor(3000, 'JPY').amountMinor).toBe(3000);
    expect(fromMajor(1.5, 'KWD').amountMinor).toBe(1500);
  });

  it('round-trips through major units', () => {
    expect(toMajor(money(1234, 'USD'))).toBe(12.34);
    expect(toMajor(money(3000, 'JPY'))).toBe(3000);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    expect(add(money(1000, 'USD'), money(250, 'USD')).amountMinor).toBe(1250);
    expect(subtract(money(1000, 'USD'), money(250, 'USD')).amountMinor).toBe(750);
  });

  it('refuses to combine two currencies without a rate', () => {
    expect(() => add(money(100, 'USD'), money(100, 'SGD'))).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero of the stated currency', () => {
    expect(sum([], 'SGD')).toEqual({ amountMinor: 0, currency: 'SGD' });
  });

  it('returns null rather than Infinity when a ratio has no denominator', () => {
    expect(ratio(money(100, 'USD'), money(0, 'USD'))).toBeNull();
    expect(ratio(money(50, 'USD'), money(200, 'USD'))).toBe(0.25);
  });
});

describe('rounding modes', () => {
  it('breaks ties to even by default', () => {
    expect(round(0.5, 'half-even')).toBe(0);
    expect(round(1.5, 'half-even')).toBe(2);
    expect(round(2.5, 'half-even')).toBe(2);
    // -0.5 sits between -1 and 0; the even neighbour is 0.
    expect(round(-0.5, 'half-even')).toBe(0);
    expect(round(-1.5, 'half-even')).toBe(-2);
    expect(round(-2.5, 'half-even')).toBe(-2);
  });

  it('breaks half-up ties away from zero, symmetrically', () => {
    expect(round(2.5, 'half-up')).toBe(3);
    expect(round(-2.5, 'half-up')).toBe(-3);
  });

  it('applies the chosen mode when multiplying', () => {
    expect(multiply(money(101, 'USD'), 0.5, 'half-up').amountMinor).toBe(51);
    expect(multiply(money(101, 'USD'), 0.5, 'floor').amountMinor).toBe(50);
  });
});

describe('allocate', () => {
  it('splits without losing or inventing a minor unit', () => {
    const parts = allocate(money(100, 'USD'), 3);
    expect(parts.map((p) => p.amountMinor)).toEqual([34, 33, 33]);
    expect(parts.reduce((total, p) => total + p.amountMinor, 0)).toBe(100);
  });

  it('spreads the remainder of a negative amount the same way', () => {
    const parts = allocate(money(-100, 'USD'), 3);
    expect(parts.reduce((total, p) => total + p.amountMinor, 0)).toBe(-100);
  });

  it('rejects a non-positive part count', () => {
    expect(() => allocate(money(100, 'USD'), 0)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('uses the currency exponent', () => {
    expect(formatMoney(money(-1234, 'USD'))).toBe('-12.34 USD');
    expect(formatMoney(money(3000, 'JPY'))).toBe('3000 JPY');
  });
});
