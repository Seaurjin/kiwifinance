/**
 * Money as an integer count of minor units plus a currency.
 *
 * PRD FR-LED-13: no floating-point amount ever reaches storage or arithmetic.
 * Multiplication by a ratio is the one place a fraction appears, and it takes
 * an explicit rounding mode on the way back to an integer.
 */

import { assertCurrencyCode, minorUnitsPerMajor, type CurrencyCode } from './currency.ts';
import { round, type RoundingMode, DEFAULT_ROUNDING } from './rounding.ts';

export interface Money {
  /** Integer count of the currency's minor unit. Negative means outflow. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(
      `Cannot combine ${left} and ${right} directly. Convert one side through an FxRate first — ` +
        `mixing currencies without a recorded rate loses the basis of the number.`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertCurrencyCode(currency);
  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError(
      `Money amount must be a safe integer of minor units, received ${amountMinor}. ` +
        `Use fromMajor() if you have a decimal amount.`,
    );
  }
  return { amountMinor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/** Build Money from a major-unit decimal, e.g. fromMajor(12.34, 'USD'). */
export function fromMajor(
  amountMajor: number,
  currency: CurrencyCode,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  if (!Number.isFinite(amountMajor)) {
    throw new RangeError(`Cannot build Money from a non-finite amount: ${amountMajor}`);
  }
  return money(round(amountMajor * minorUnitsPerMajor(currency), mode), currency);
}

/** Decimal major units. For display and export only — never for arithmetic. */
export function toMajor(m: Money): number {
  return m.amountMinor / minorUnitsPerMajor(m.currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(m: Money): Money {
  return money(-m.amountMinor, m.currency);
}

export function abs(m: Money): Money {
  return money(Math.abs(m.amountMinor), m.currency);
}

/** Multiply by a plain ratio (a share, a rate, a count). Rounding is explicit. */
export function multiply(m: Money, factor: number, mode: RoundingMode = DEFAULT_ROUNDING): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Cannot multiply Money by a non-finite factor: ${factor}`);
  }
  return money(round(m.amountMinor * factor, mode), m.currency);
}

/**
 * Split an amount into `parts` pieces that sum back to exactly the original.
 * Used by daily budget allowance (FR-LED-11) — the remainder is spread over the
 * leading parts rather than lost to rounding.
 */
export function allocate(m: Money, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new RangeError(`Cannot allocate into ${parts} parts; expected a positive integer.`);
  }
  const base = Math.trunc(m.amountMinor / parts);
  let remainder = m.amountMinor - base * parts;
  const step = remainder >= 0 ? 1 : -1;

  return Array.from({ length: parts }, () => {
    let slice = base;
    if (remainder !== 0) {
      slice += step;
      remainder -= step;
    }
    return money(slice, m.currency);
  });
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0;
}

export function isNegative(m: Money): boolean {
  return m.amountMinor < 0;
}

export function isPositive(m: Money): boolean {
  return m.amountMinor > 0;
}

/**
 * A ratio between two amounts of the same currency, as a plain number.
 * Returns null rather than Infinity/NaN when the denominator is zero — callers
 * must decide what "no denominator" means for their metric.
 */
export function ratio(numerator: Money, denominator: Money): number | null {
  assertSameCurrency(numerator, denominator);
  if (denominator.amountMinor === 0) return null;
  return numerator.amountMinor / denominator.amountMinor;
}

/** Stable, locale-independent form for logs, snapshots and hashes. */
export function formatMoney(m: Money): string {
  const units = minorUnitsPerMajor(m.currency);
  const sign = m.amountMinor < 0 ? '-' : '';
  const magnitude = Math.abs(m.amountMinor);
  if (units === 1) return `${sign}${magnitude} ${m.currency}`;
  const whole = Math.trunc(magnitude / units);
  const frac = String(magnitude % units).padStart(String(units).length - 1, '0');
  return `${sign}${whole}.${frac} ${m.currency}`;
}
