/**
 * Unusual spending, and the tax-preparation metrics.
 *
 * "Unusual" is defined against the category's own history rather than one
 * global threshold: 200 on groceries is not the same event as 200 on coffee.
 * The comparison is to a median, not a mean, so one large charge last month
 * does not raise the bar and hide the next one.
 *
 * A row also has to clear an absolute floor. Without it, a category whose
 * normal charge is small produces "anomalies" all day.
 */

import { addDays, period as makePeriod, type Period } from '@kiwi/core';
import { categoryIndex, expenses as expenseRows, topLevelCategoryId } from '@kiwi/ledger';
import { baseMagnitude, idsOf, sumBaseMagnitude } from './base-value.ts';
import { selectTransactions } from './select.ts';
import type { Fact, MetricContext, MetricDefinition, ScalarFact, SeriesRow } from './types.ts';

const HISTORY_DAYS = 180;
/** How many times the category median counts as out of the ordinary. */
const MULTIPLE = 3;
/** Minor units of the base currency a row must exceed to be worth flagging. */
const FLOOR_MINOR = 5_000;
/** Fewest historical rows before a category's median means anything. */
const MIN_HISTORY = 3;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function historyPeriod(reportPeriod: Period): Period {
  return makePeriod(addDays(reportPeriod.from, -HISTORY_DAYS), reportPeriod.to);
}

export const largeAnomalies: MetricDefinition = {
  id: 'large_anomalies',
  label: 'Unusual spending',
  unit: 'money',
  returns: 'series',
  description:
    'Charges more than three times the usual size for their category, measured against ' +
    'that category’s own median over the last six months.',
  compute(ctx): Fact {
    const index = categoryIndex(ctx.snapshot);
    const history = expenseRows(
      selectTransactions(ctx.snapshot, historyPeriod(ctx.period), ctx.filters),
    );

    const byCategory = new Map<string, number[]>();
    for (const txn of history) {
      const key = topLevelCategoryId(index, txn.categoryId) ?? '__uncategorized';
      const bucket = byCategory.get(key);
      const amount = baseMagnitude(txn, ctx);
      if (bucket === undefined) byCategory.set(key, [amount]);
      else bucket.push(amount);
    }

    const medians = new Map(
      [...byCategory.entries()].map(([key, amounts]) => [key, median(amounts)]),
    );

    const rows: SeriesRow[] = expenseRows(ctx.transactions)
      .filter((txn) => {
        const key = topLevelCategoryId(index, txn.categoryId) ?? '__uncategorized';
        const sampleSize = byCategory.get(key)?.length ?? 0;
        const norm = medians.get(key) ?? 0;
        if (sampleSize < MIN_HISTORY || norm === 0) return false;
        const amount = baseMagnitude(txn, ctx);
        return amount >= FLOOR_MINOR && amount > norm * MULTIPLE;
      })
      .map((txn) => {
        const key = topLevelCategoryId(index, txn.categoryId) ?? '__uncategorized';
        const norm = medians.get(key) ?? 0;
        const amount = baseMagnitude(txn, ctx);
        return {
          key: txn.id,
          label: `${txn.merchantName ?? txn.note ?? 'Untitled'} · ${
            index.get(key)?.name ?? 'Uncategorised'
          } · ${(amount / norm).toFixed(1)}× usual`,
          value: amount,
          sourceTxnIds: [txn.id],
        };
      })
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.key.localeCompare(b.key));

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

export const rollingAvg: MetricDefinition = {
  id: 'rolling_avg',
  label: 'Usual daily spending',
  unit: 'money',
  returns: 'scalar',
  description:
    'Average spending per day over the six months before this period, for comparing ' +
    'the current period against a normal one.',
  compute(ctx): ScalarFact {
    const history = expenseRows(
      selectTransactions(
        ctx.snapshot,
        makePeriod(addDays(ctx.period.from, -HISTORY_DAYS), addDays(ctx.period.from, -1)),
        ctx.filters,
      ),
    );

    if (history.length === 0) {
      return {
        kind: 'scalar',
        metric: this.id,
        label: this.label,
        unit: 'money',
        currency: ctx.baseCurrency,
        value: null,
        unavailableReason: 'No spending before this period to compare against.',
        sourceTxnIds: [],
      };
    }

    return {
      kind: 'scalar',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      value: Math.round(sumBaseMagnitude(history, ctx) / HISTORY_DAYS),
      sourceTxnIds: idsOf(history),
    };
  },
};

/** The tag a user puts on something they intend to claim. */
export const DEDUCTIBLE_TAG = 'deductible';

export const deductibleTotal: MetricDefinition = {
  id: 'deductible_total',
  label: 'Claimable spending',
  unit: 'money',
  returns: 'scalar',
  description:
    'Spending tagged “deductible”. The tag is the user’s judgement, not ours — nothing ' +
    'is claimed on their behalf.',
  compute(ctx): ScalarFact {
    const rows = expenseRows(ctx.transactions).filter((txn) =>
      txn.tags.includes(DEDUCTIBLE_TAG),
    );
    return {
      kind: 'scalar',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      value: sumBaseMagnitude(rows, ctx),
      sourceTxnIds: idsOf(rows),
    };
  },
};

export const categoryExport: MetricDefinition = {
  id: 'category_export',
  label: 'Spending by exact category',
  unit: 'money',
  returns: 'series',
  description:
    'Spending by leaf category rather than rolled up, which is the breakdown an ' +
    'accountant asks for.',
  compute(ctx): Fact {
    const index = categoryIndex(ctx.snapshot);
    const grouped = new Map<string, typeof ctx.transactions>();

    for (const txn of expenseRows(ctx.transactions)) {
      const key = txn.categoryId ?? '__uncategorized';
      const bucket = grouped.get(key);
      grouped.set(key, bucket === undefined ? [txn] : [...bucket, txn]);
    }

    const rows: SeriesRow[] = [...grouped.entries()]
      .map(([key, txns]) => ({
        key,
        label: key === '__uncategorized' ? 'Uncategorised' : (index.get(key)?.name ?? key),
        value: sumBaseMagnitude(txns, ctx),
        sourceTxnIds: idsOf(txns),
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

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
