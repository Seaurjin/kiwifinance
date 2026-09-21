/**
 * Turning a transaction into a comparable number in the base currency.
 *
 * This is where FR-LED-02's two rate bases become concrete:
 *
 *   'transaction' — use the rate frozen on the row. Answers "what did this
 *       actually cost me", bank spread included. Requires no extra data, and
 *       is always reproducible because the rate is stored.
 *
 *   'reporting'  — re-convert the original amount at one common rate for the
 *       whole period, removing FX movement from a period-over-period
 *       comparison. Requires a rate table; without one we throw rather than
 *       quietly fall back, because a silently mixed basis is the classic way
 *       financial software produces numbers nobody can reconcile.
 */

import { minorUnitsPerMajor, round, type CurrencyCode } from '@kiwi/core';
import type { Transaction } from '@kiwi/ledger';
import { FxModeUnsupportedError, type MetricContext } from './types.ts';

/** Signed minor units of the base currency, under the context's FX mode. */
export function baseValue(txn: Transaction, ctx: MetricContext): number {
  if (ctx.fxMode === 'transaction') {
    return txn.baseAmountMinor;
  }

  if (txn.currency === ctx.baseCurrency) {
    return txn.amountMinor;
  }

  const rate = ctx.reportingRates?.get(txn.currency);
  if (rate === undefined) {
    throw new FxModeUnsupportedError(
      `Reporting FX mode needs a rate for ${txn.currency} → ${ctx.baseCurrency}, but none was supplied. ` +
        `Provide reportingRates for every currency in the period, or run the report in 'transaction' mode.`,
    );
  }

  const majors = txn.amountMinor / minorUnitsPerMajor(txn.currency);
  return round(majors * rate * minorUnitsPerMajor(ctx.baseCurrency));
}

/** Magnitude in base minor units, sign discarded. */
export function baseMagnitude(txn: Transaction, ctx: MetricContext): number {
  return Math.abs(baseValue(txn, ctx));
}

export function sumBaseValue(txns: readonly Transaction[], ctx: MetricContext): number {
  return txns.reduce((total, txn) => total + baseValue(txn, ctx), 0);
}

export function sumBaseMagnitude(txns: readonly Transaction[], ctx: MetricContext): number {
  return txns.reduce((total, txn) => total + baseMagnitude(txn, ctx), 0);
}

export function idsOf(txns: readonly Transaction[]): string[] {
  return txns.map((t) => t.id);
}

export function baseCurrencyOf(ctx: MetricContext): CurrencyCode {
  return ctx.baseCurrency;
}
