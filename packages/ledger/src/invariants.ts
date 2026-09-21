/**
 * Invariants every transaction must satisfy before it is written.
 *
 * These are checked in code rather than left to the database because most of
 * them are cross-column rules (sign vs kind, frozen FX vs original amount)
 * that a CHECK constraint cannot express portably.
 */

import { assertCurrencyCode, convert, fxRate, isIsoDate, money } from '@kiwi/core';
import type { Transaction } from './types.ts';

export class LedgerInvariantError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerInvariantError';
  }
}

/** Largest relative difference tolerated between stored and recomputed base amount. */
const BASE_AMOUNT_TOLERANCE_MINOR = 1;

export function validateTransaction(txn: Transaction): void {
  assertCurrencyCode(txn.currency);
  assertCurrencyCode(txn.baseCurrency);

  if (!isIsoDate(txn.date)) {
    throw new LedgerInvariantError('date_invalid', `Transaction date "${txn.date}" is not YYYY-MM-DD.`);
  }
  if (!isIsoDate(txn.fxAsOf)) {
    throw new LedgerInvariantError('fx_as_of_invalid', `fxAsOf "${txn.fxAsOf}" is not YYYY-MM-DD.`);
  }

  if (!Number.isSafeInteger(txn.amountMinor)) {
    throw new LedgerInvariantError(
      'amount_not_integer',
      `amountMinor must be an integer of minor units, received ${txn.amountMinor}.`,
    );
  }
  if (!Number.isSafeInteger(txn.baseAmountMinor)) {
    throw new LedgerInvariantError(
      'base_amount_not_integer',
      `baseAmountMinor must be an integer of minor units, received ${txn.baseAmountMinor}.`,
    );
  }

  if (!Number.isFinite(txn.fxRate) || txn.fxRate <= 0) {
    throw new LedgerInvariantError(
      'fx_rate_invalid',
      `fxRate must be a positive finite number, received ${txn.fxRate}.`,
    );
  }

  // Sign convention. Getting this wrong makes every total wrong, silently.
  if (txn.kind === 'expense' && txn.amountMinor > 0) {
    throw new LedgerInvariantError(
      'expense_sign',
      `Expenses must be negative or zero; ${txn.id} has ${txn.amountMinor}.`,
    );
  }
  if (txn.kind === 'income' && txn.amountMinor < 0) {
    throw new LedgerInvariantError(
      'income_sign',
      `Income must be positive or zero; ${txn.id} has ${txn.amountMinor}.`,
    );
  }

  // The original and the frozen base amount must point the same way.
  if (Math.sign(txn.amountMinor) !== Math.sign(txn.baseAmountMinor)) {
    throw new LedgerInvariantError(
      'base_amount_sign',
      `amountMinor (${txn.amountMinor}) and baseAmountMinor (${txn.baseAmountMinor}) disagree on direction.`,
    );
  }

  // Same currency means the rate is 1 and the amounts are identical.
  if (txn.currency === txn.baseCurrency) {
    if (txn.fxRate !== 1) {
      throw new LedgerInvariantError(
        'same_currency_rate',
        `A ${txn.currency} transaction in a ${txn.baseCurrency} ledger must have fxRate 1, got ${txn.fxRate}.`,
      );
    }
    if (txn.amountMinor !== txn.baseAmountMinor) {
      throw new LedgerInvariantError(
        'same_currency_amount',
        `A same-currency transaction must have equal amountMinor and baseAmountMinor.`,
      );
    }
  } else {
    // The frozen base amount has to be reproducible from the stored rate.
    // One minor unit of slack covers the rounding mode used at write time.
    const recomputed = convert(
      money(txn.amountMinor, txn.currency),
      fxRate({
        from: txn.currency,
        to: txn.baseCurrency,
        rate: txn.fxRate,
        source: txn.fxRateSource,
        asOf: txn.fxAsOf,
      }),
    );
    if (Math.abs(recomputed.amountMinor - txn.baseAmountMinor) > BASE_AMOUNT_TOLERANCE_MINOR) {
      throw new LedgerInvariantError(
        'base_amount_unreproducible',
        `Stored baseAmountMinor ${txn.baseAmountMinor} cannot be reproduced from amountMinor ` +
          `${txn.amountMinor} at rate ${txn.fxRate} (got ${recomputed.amountMinor}).`,
      );
    }
  }

  if (txn.aiConfidence !== null && (txn.aiConfidence < 0 || txn.aiConfidence > 1)) {
    throw new LedgerInvariantError(
      'confidence_range',
      `aiConfidence must be between 0 and 1, received ${txn.aiConfidence}.`,
    );
  }

  // An AI-produced row without provenance cannot satisfy FR-CAP-09.
  if (txn.source !== 'manual' && txn.source !== 'bank' && txn.provenanceId === null) {
    throw new LedgerInvariantError(
      'provenance_missing',
      `A ${txn.source} transaction must carry a provenanceId so its origin stays traceable.`,
    );
  }

  // Transfers and FX trades exist in pairs.
  if ((txn.kind === 'transfer' || txn.kind === 'fx_trade') && txn.linkId === null) {
    throw new LedgerInvariantError(
      'link_missing',
      `A ${txn.kind} must carry a linkId tying it to its other leg.`,
    );
  }
}

/** Validate a whole batch, collecting every failure rather than stopping at the first. */
export function validateTransactions(txns: readonly Transaction[]): LedgerInvariantError[] {
  const errors: LedgerInvariantError[] = [];
  for (const txn of txns) {
    try {
      validateTransaction(txn);
    } catch (error) {
      if (error instanceof LedgerInvariantError) errors.push(error);
      else throw error;
    }
  }
  return errors;
}
