/**
 * Recurring-charge detection.
 *
 * Deliberately a rule, not a model. A subscription is a merchant you paid a
 * similar amount to at a regular interval, which is a shape in the data, and
 * describing it in code means the answer is explainable ("three charges, about
 * 30 days apart") rather than asserted.
 *
 * It looks further back than the report's period, because you cannot see a
 * monthly cadence inside one month.
 */

import { addDays, period as makePeriod, type IsoDate, type Period } from '@kiwi/core';
import { expenses as expenseRows, type Transaction } from '@kiwi/ledger';
import { baseMagnitude, idsOf } from './base-value.ts';
import { selectTransactions } from './select.ts';
import type { Fact, MetricContext, MetricDefinition, ScalarFact, SeriesRow } from './types.ts';

/** How far back to look for a cadence. A year catches annual renewals. */
const LOOKBACK_DAYS = 400;
/** Fewest charges before a pattern is a pattern rather than a coincidence. */
const MIN_OCCURRENCES = 3;

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCE_WINDOWS: readonly { cadence: Cadence; min: number; max: number; perMonth: number }[] = [
  { cadence: 'weekly', min: 5, max: 9, perMonth: 52 / 12 },
  { cadence: 'monthly', min: 24, max: 38, perMonth: 1 },
  { cadence: 'quarterly', min: 80, max: 100, perMonth: 1 / 3 },
  { cadence: 'yearly', min: 350, max: 380, perMonth: 1 / 12 },
];

export interface RecurringCharge {
  readonly merchant: string;
  readonly cadence: Cadence;
  readonly occurrences: number;
  readonly medianGapDays: number;
  /** Base minor units of the most recent charge. */
  readonly latestAmount: number;
  /** The charge before it, for a price comparison. */
  readonly previousAmount: number | null;
  readonly latestDate: IsoDate;
  /** What this costs per month, for a comparable total across cadences. */
  readonly monthlyEquivalent: number;
  readonly sourceTxnIds: readonly string[];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function lookbackPeriod(reportPeriod: Period): Period {
  return makePeriod(addDays(reportPeriod.to, -LOOKBACK_DAYS), reportPeriod.to);
}

/**
 * Find recurring charges in the transactions available to this context.
 * Exported so the API and the MCP surface can reuse the same detection.
 */
export function detectRecurring(ctx: MetricContext): RecurringCharge[] {
  const history = expenseRows(
    selectTransactions(ctx.snapshot, lookbackPeriod(ctx.period), ctx.filters),
  );

  const byMerchant = new Map<string, Transaction[]>();
  for (const txn of history) {
    if (txn.merchantName === null) continue;
    const key = txn.merchantName.trim().toLowerCase();
    const bucket = byMerchant.get(key);
    if (bucket === undefined) byMerchant.set(key, [txn]);
    else bucket.push(txn);
  }

  const found: RecurringCharge[] = [];

  for (const group of byMerchant.values()) {
    if (group.length < MIN_OCCURRENCES) continue;

    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      gaps.push(daysBetween(ordered[index - 1]!.date, ordered[index]!.date));
    }

    const medianGap = median(gaps);
    const window = CADENCE_WINDOWS.find((c) => medianGap >= c.min && medianGap <= c.max);
    if (window === undefined) continue;

    const latest = ordered[ordered.length - 1]!;
    const previous = ordered[ordered.length - 2] ?? null;
    const latestAmount = baseMagnitude(latest, ctx);

    found.push({
      merchant: latest.merchantName ?? '',
      cadence: window.cadence,
      occurrences: ordered.length,
      medianGapDays: Math.round(medianGap),
      latestAmount,
      previousAmount: previous === null ? null : baseMagnitude(previous, ctx),
      latestDate: latest.date,
      monthlyEquivalent: Math.round(latestAmount * window.perMonth),
      sourceTxnIds: idsOf(ordered),
    });
  }

  return found.sort(
    (a, b) => b.monthlyEquivalent - a.monthlyEquivalent || a.merchant.localeCompare(b.merchant),
  );
}

/** A rise this large is worth telling someone about. */
const PRICE_RISE_THRESHOLD = 0.05;

export const recurringDetected: MetricDefinition = {
  id: 'recurring_detected',
  label: 'Recurring charges',
  unit: 'money',
  returns: 'series',
  description:
    'Merchants you pay on a regular cadence, with what each costs per month. Found by ' +
    'looking for at least three charges at a steady interval, not by guessing.',
  compute(ctx): Fact {
    const rows: SeriesRow[] = detectRecurring(ctx).map((charge) => ({
      key: charge.merchant.toLowerCase(),
      label: `${charge.merchant} · ${charge.cadence}`,
      value: charge.monthlyEquivalent,
      sourceTxnIds: charge.sourceTxnIds,
    }));

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows,
      sourceTxnIds: rows.flatMap((row) => row.sourceTxnIds),
    };
  },
};

export const subscriptionTotal: MetricDefinition = {
  id: 'subscription_total',
  label: 'Recurring spend per month',
  unit: 'money',
  returns: 'scalar',
  description: 'What every recurring charge adds up to in a month, whatever its own cadence.',
  compute(ctx): ScalarFact {
    const charges = detectRecurring(ctx);
    const total = charges.reduce((sum, charge) => sum + charge.monthlyEquivalent, 0);
    return {
      kind: 'scalar',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      value: total,
      sourceTxnIds: charges.flatMap((charge) => charge.sourceTxnIds),
    };
  },
};

export const priceIncreaseAlert: MetricDefinition = {
  id: 'price_increase_alert',
  label: 'Recurring charges that went up',
  unit: 'money',
  returns: 'series',
  description:
    'Recurring charges whose latest amount is more than 5% above the one before it. ' +
    'The value is the size of the rise.',
  compute(ctx): Fact {
    const rows: SeriesRow[] = detectRecurring(ctx)
      .filter(
        (charge) =>
          charge.previousAmount !== null &&
          charge.previousAmount > 0 &&
          (charge.latestAmount - charge.previousAmount) / charge.previousAmount >
            PRICE_RISE_THRESHOLD,
      )
      .map((charge) => ({
        key: charge.merchant.toLowerCase(),
        label: charge.merchant,
        value: charge.latestAmount - (charge.previousAmount ?? 0),
        sourceTxnIds: charge.sourceTxnIds.slice(-2),
      }));

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows,
      sourceTxnIds: rows.flatMap((row) => row.sourceTxnIds),
    };
  },
};
