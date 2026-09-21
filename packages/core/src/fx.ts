/**
 * Foreign exchange.
 *
 * Two PRD requirements shape everything here:
 *
 *  - FR-LED-02 — two rate bases exist and must never be silently mixed.
 *      'transaction' is the rate that actually happened (what the card issuer
 *      charged, bank spread included). It answers "what did this cost me".
 *      'reporting' is a common mid-market rate applied across a period. It
 *      answers "how do these periods compare" with FX noise removed.
 *
 *  - FR-LED-03 — a converted amount is frozen when the transaction is written
 *      and never recomputed. `convert` is therefore used at write time, and
 *      readers use the stored `baseAmountMinor`.
 */

import type { CurrencyCode } from './currency.ts';
import { assertCurrencyCode } from './currency.ts';
import { minorUnitsPerMajor } from './currency.ts';
import { money, type Money } from './money.ts';
import { round, type RoundingMode, DEFAULT_ROUNDING } from './rounding.ts';

/** Which rate basis a number was produced under. Always travels with the number. */
export type FxMode = 'transaction' | 'reporting';

/** Where a rate came from. Drives trust and is shown in the UI. */
export type FxRateSource =
  /** Read off the user's card or bank statement. The most truthful rate. */
  | 'card_statement'
  /** ECB / Frankfurter daily reference rate. */
  | 'ecb'
  /** Supplied by a bank-aggregation provider. */
  | 'provider'
  /** Typed in by the user. */
  | 'manual';

export interface FxRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Major units of `to` per one major unit of `from`. */
  readonly rate: number;
  readonly source: FxRateSource;
  /** ISO date (YYYY-MM-DD) the rate applies to. */
  readonly asOf: string;
}

export class FxRateMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`FX rate does not apply here: expected ${expected}, got ${actual}.`);
    this.name = 'FxRateMismatchError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function fxRate(input: FxRate): FxRate {
  assertCurrencyCode(input.from);
  assertCurrencyCode(input.to);
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw new RangeError(`FX rate must be a positive finite number, received ${input.rate}.`);
  }
  if (!ISO_DATE.test(input.asOf)) {
    throw new TypeError(`FX rate asOf must be an ISO date (YYYY-MM-DD), received "${input.asOf}".`);
  }
  return Object.freeze({ ...input });
}

/** An identity rate, for when a transaction is already in the base currency. */
export function identityRate(currency: CurrencyCode, asOf: string): FxRate {
  return fxRate({ from: currency, to: currency, rate: 1, source: 'manual', asOf });
}

/**
 * Convert an amount using a rate. Deterministic: same inputs, same output,
 * which is what makes a stored base amount reproducible in a test.
 *
 * The conversion goes through major units because that is what a quoted rate
 * means, then rounds once, explicitly, back to the target's minor units.
 */
export function convert(
  amount: Money,
  rate: FxRate,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  if (amount.currency !== rate.from) {
    throw new FxRateMismatchError(`a rate from ${amount.currency}`, `a rate from ${rate.from}`);
  }
  if (rate.from === rate.to) {
    return money(amount.amountMinor, rate.to);
  }

  const majors = amount.amountMinor / minorUnitsPerMajor(rate.from);
  const converted = majors * rate.rate;
  return money(round(converted * minorUnitsPerMajor(rate.to), mode), rate.to);
}

/** Invert a rate, keeping its provenance. Used for two-legged FX trades. */
export function invertRate(rate: FxRate): FxRate {
  return fxRate({
    from: rate.to,
    to: rate.from,
    rate: 1 / rate.rate,
    source: rate.source,
    asOf: rate.asOf,
  });
}

/**
 * The FX fields frozen onto every transaction at write time.
 * Readers use `baseAmountMinor` directly and never re-derive it (FR-LED-03).
 */
export interface FrozenConversion {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly fxRate: number;
  readonly fxRateSource: FxRateSource;
  readonly fxAsOf: string;
  readonly baseAmountMinor: number;
  readonly baseCurrency: CurrencyCode;
}

/** Produce the frozen FX columns for a transaction about to be written. */
export function freezeConversion(
  amount: Money,
  rate: FxRate,
  mode: RoundingMode = DEFAULT_ROUNDING,
): FrozenConversion {
  const base = convert(amount, rate, mode);
  return Object.freeze({
    amountMinor: amount.amountMinor,
    currency: amount.currency,
    fxRate: rate.rate,
    fxRateSource: rate.source,
    fxAsOf: rate.asOf,
    baseAmountMinor: base.amountMinor,
    baseCurrency: base.currency,
  });
}

/** Read the stored base amount back as Money. No recomputation. */
export function baseAmount(frozen: FrozenConversion): Money {
  return money(frozen.baseAmountMinor, frozen.baseCurrency);
}

/** Read the original amount back as Money. */
export function originalAmount(frozen: FrozenConversion): Money {
  return money(frozen.amountMinor, frozen.currency);
}

/** True when the transaction was not denominated in the base currency. */
export function isForeign(frozen: FrozenConversion): boolean {
  return frozen.currency !== frozen.baseCurrency;
}
