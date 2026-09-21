/**
 * The metric library.
 *
 * PRD Phase 0 asked for twelve; there are twenty, because the three standard
 * reports that were waiting on metrics now have them.
 *
 * Each one is a pure function of its context. Adding a metric means adding a
 * tested function here, never editing a prompt.
 */

import { monthKey, previousPeriod, remainingDays, type IsoDate } from '@kiwi/core';
import {
  categoryIndex,
  expenses as expenseRows,
  income as incomeRows,
  topLevelCategoryId,
  type Transaction,
} from '@kiwi/ledger';
import { baseMagnitude, idsOf, sumBaseMagnitude, sumBaseValue } from './base-value.ts';
import { selectTransactions } from './select.ts';
import type { Fact, MetricContext, MetricDefinition, ScalarFact, SeriesRow } from './types.ts';
import { largeAnomalies, categoryExport, deductibleTotal, rollingAvg } from './anomaly.ts';
import { priceIncreaseAlert, recurringDetected, subscriptionTotal } from './recurring.ts';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function scalar(
  ctx: MetricContext,
  id: string,
  label: string,
  unit: ScalarFact['unit'],
  value: number | null,
  txns: readonly Transaction[],
  unavailableReason?: string,
): ScalarFact {
  const fact: ScalarFact = {
    kind: 'scalar',
    metric: id,
    label,
    unit,
    value,
    sourceTxnIds: idsOf(txns),
    ...(unit === 'money' ? { currency: ctx.baseCurrency } : {}),
    ...(unavailableReason !== undefined ? { unavailableReason } : {}),
  };
  return fact;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket === undefined) map.set(k, [item]);
    else bucket.push(item);
  }
  return map;
}

/** Descending by value, with a stable tiebreak on key so output is reproducible. */
function sortRows(rows: SeriesRow[]): SeriesRow[] {
  return rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.key.localeCompare(b.key));
}

function readNumberParam(ctx: MetricContext, name: string, fallback: number): number {
  const raw = ctx.params[name];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new TypeError(`Parameter "${name}" must be a finite number, received ${JSON.stringify(raw)}.`);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

const expenseTotal: MetricDefinition = {
  id: 'expense_total',
  label: 'Total spending',
  unit: 'money',
  returns: 'scalar',
  description: 'Sum of all spending in the period, as a positive amount in the base currency.',
  compute(ctx) {
    const rows = expenseRows(ctx.transactions);
    return scalar(ctx, this.id, this.label, 'money', sumBaseMagnitude(rows, ctx), rows);
  },
};

const incomeTotal: MetricDefinition = {
  id: 'income_total',
  label: 'Total income',
  unit: 'money',
  returns: 'scalar',
  description: 'Sum of all income in the period, in the base currency.',
  compute(ctx) {
    const rows = incomeRows(ctx.transactions);
    return scalar(ctx, this.id, this.label, 'money', sumBaseMagnitude(rows, ctx), rows);
  },
};

const netCashFlow: MetricDefinition = {
  id: 'net_cash_flow',
  label: 'Net cash flow',
  unit: 'money',
  returns: 'scalar',
  description:
    'Income minus spending. Transfers and FX legs are excluded, so moving money between ' +
    'your own accounts never shows up as a gain or a loss.',
  compute(ctx) {
    const rows = [...incomeRows(ctx.transactions), ...expenseRows(ctx.transactions)];
    return scalar(ctx, this.id, this.label, 'money', sumBaseValue(rows, ctx), rows);
  },
};

const savingsRate: MetricDefinition = {
  id: 'savings_rate',
  label: 'Savings rate',
  unit: 'ratio',
  returns: 'scalar',
  description: 'Share of income that was not spent. Undefined when there was no income.',
  compute(ctx) {
    const income = incomeRows(ctx.transactions);
    const expense = expenseRows(ctx.transactions);
    const rows = [...income, ...expense];
    const incomeTotalMinor = sumBaseMagnitude(income, ctx);
    if (incomeTotalMinor === 0) {
      return scalar(ctx, this.id, this.label, 'ratio', null, rows, 'No income in this period.');
    }
    const spent = sumBaseMagnitude(expense, ctx);
    return scalar(ctx, this.id, this.label, 'ratio', (incomeTotalMinor - spent) / incomeTotalMinor, rows);
  },
};

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const categoryShare: MetricDefinition = {
  id: 'category_share',
  label: 'Spending by category',
  unit: 'money',
  returns: 'series',
  description:
    'Spending grouped by top-level category, largest first, each with its share of the total.',
  compute(ctx): Fact {
    const index = categoryIndex(ctx.snapshot);
    const rows = expenseRows(ctx.transactions);
    const total = sumBaseMagnitude(rows, ctx);
    const grouped = groupBy(rows, (txn) => topLevelCategoryId(index, txn.categoryId) ?? '__uncategorized');

    const series = sortRows(
      [...grouped.entries()].map(([key, txns]) => {
        const value = sumBaseMagnitude(txns, ctx);
        return {
          key,
          label: key === '__uncategorized' ? 'Uncategorised' : (index.get(key)?.name ?? key),
          value,
          share: total === 0 ? 0 : value / total,
          sourceTxnIds: idsOf(txns),
        };
      }),
    );

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows: series,
      sourceTxnIds: idsOf(rows),
    };
  },
};

const topMerchants: MetricDefinition = {
  id: 'top_merchants',
  label: 'Top merchants',
  unit: 'money',
  returns: 'series',
  description: 'Merchants you spent the most with, largest first.',
  params: { limit: { type: 'number', description: 'How many merchants to return. Default 10.' } },
  compute(ctx): Fact {
    const limit = readNumberParam(ctx, 'limit', 10);
    const rows = expenseRows(ctx.transactions).filter((t) => t.merchantName !== null);
    const grouped = groupBy(rows, (txn) => txn.merchantName as string);

    const series = sortRows(
      [...grouped.entries()].map(([key, txns]) => ({
        key,
        label: key,
        value: sumBaseMagnitude(txns, ctx),
        sourceTxnIds: idsOf(txns),
      })),
    ).slice(0, Math.max(0, Math.trunc(limit)));

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows: series,
      sourceTxnIds: series.flatMap((row) => row.sourceTxnIds),
    };
  },
};

// ---------------------------------------------------------------------------
// Multi-currency
// ---------------------------------------------------------------------------

const spendByCurrency: MetricDefinition = {
  id: 'spend_by_currency',
  label: 'Spending by currency',
  unit: 'money',
  returns: 'series',
  description:
    'Spending grouped by the currency it was actually denominated in, converted to the ' +
    'base currency for comparison.',
  compute(ctx): Fact {
    const rows = expenseRows(ctx.transactions);
    const total = sumBaseMagnitude(rows, ctx);
    const grouped = groupBy(rows, (txn) => txn.currency);

    const series = sortRows(
      [...grouped.entries()].map(([key, txns]) => {
        const value = sumBaseMagnitude(txns, ctx);
        return {
          key,
          label: key,
          value,
          share: total === 0 ? 0 : value / total,
          sourceTxnIds: idsOf(txns),
        };
      }),
    );

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows: series,
      sourceTxnIds: idsOf(rows),
    };
  },
};

const fxExposure: MetricDefinition = {
  id: 'fx_exposure',
  label: 'FX exposure',
  unit: 'ratio',
  returns: 'scalar',
  description:
    'Share of spending that was not in your base currency, and so moved with exchange rates.',
  compute(ctx) {
    const rows = expenseRows(ctx.transactions);
    const total = sumBaseMagnitude(rows, ctx);
    if (total === 0) {
      return scalar(ctx, this.id, this.label, 'ratio', null, rows, 'No spending in this period.');
    }
    const foreign = rows.filter((txn) => txn.currency !== ctx.baseCurrency);
    return scalar(ctx, this.id, this.label, 'ratio', sumBaseMagnitude(foreign, ctx) / total, foreign);
  },
};

// ---------------------------------------------------------------------------
// Time comparison
// ---------------------------------------------------------------------------

const momDelta: MetricDefinition = {
  id: 'mom_delta',
  label: 'Change vs previous period',
  unit: 'money',
  returns: 'scalar',
  description:
    'Spending in this period minus spending in the equally long period immediately before it. ' +
    'Positive means you spent more this time.',
  compute(ctx) {
    const current = expenseRows(ctx.transactions);
    const priorPeriod = previousPeriod(ctx.period);
    const prior = expenseRows(selectTransactions(ctx.snapshot, priorPeriod, ctx.filters));

    const delta = sumBaseMagnitude(current, ctx) - sumBaseMagnitude(prior, ctx);
    // Both periods are cited: the figure is not traceable from one alone.
    return scalar(ctx, this.id, this.label, 'money', delta, [...current, ...prior]);
  },
};

const spendByMonth: MetricDefinition = {
  id: 'spend_by_month',
  label: 'Spending by month',
  unit: 'money',
  returns: 'series',
  description: 'Spending totalled per calendar month, oldest first.',
  compute(ctx): Fact {
    const rows = expenseRows(ctx.transactions);
    const grouped = groupBy(rows, (txn) => monthKey(txn.date));

    const series = [...grouped.entries()]
      .map(([key, txns]) => ({
        key,
        label: key,
        value: sumBaseMagnitude(txns, ctx),
        sourceTxnIds: idsOf(txns),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows: series,
      sourceTxnIds: idsOf(rows),
    };
  },
};

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

function activeBudgets(ctx: MetricContext) {
  const periodMonth = ctx.period.from.slice(0, 7);
  return ctx.snapshot.budgets.filter(
    (b) => b.deletedAt === null && b.effectiveFrom <= periodMonth && b.currency === ctx.baseCurrency,
  );
}

const budgetVariance: MetricDefinition = {
  id: 'budget_variance',
  label: 'Budget variance',
  unit: 'money',
  returns: 'series',
  description:
    'For each budget, how much is left. Negative means you are over. Budgets set on a ' +
    'category include everything beneath it.',
  compute(ctx): Fact {
    const index = categoryIndex(ctx.snapshot);
    const rows = expenseRows(ctx.transactions);

    const series = activeBudgets(ctx).map((budget) => {
      const matching =
        budget.categoryId === null
          ? rows
          : rows.filter(
              (txn) => topLevelCategoryId(index, txn.categoryId) === budget.categoryId,
            );
      const spent = sumBaseMagnitude(matching, ctx);
      return {
        key: budget.id,
        label:
          budget.categoryId === null
            ? 'Overall'
            : (index.get(budget.categoryId)?.name ?? budget.categoryId),
        value: budget.amountMinor - spent,
        sourceTxnIds: idsOf(matching),
      };
    });

    return {
      kind: 'series',
      metric: this.id,
      label: this.label,
      unit: 'money',
      currency: ctx.baseCurrency,
      rows: series.sort((a, b) => (a.value ?? 0) - (b.value ?? 0) || a.key.localeCompare(b.key)),
      sourceTxnIds: idsOf(rows),
    };
  },
};

const dailyAllowance: MetricDefinition = {
  id: 'daily_allowance',
  label: 'Daily allowance left',
  unit: 'money',
  returns: 'scalar',
  description:
    'What is left of the overall budget divided by the days remaining, so overspending ' +
    'earlier in the month lowers the rest of the month rather than being discovered at the end.',
  compute(ctx) {
    const overall = activeBudgets(ctx).find((b) => b.categoryId === null);
    const rows = expenseRows(ctx.transactions);

    if (overall === undefined) {
      return scalar(
        ctx,
        this.id,
        this.label,
        'money',
        null,
        rows,
        'No overall budget is set for this period.',
      );
    }

    const remaining = remainingDays(ctx.period, ctx.today as IsoDate);
    if (remaining <= 0) {
      return scalar(ctx, this.id, this.label, 'money', null, rows, 'The period is already over.');
    }

    const left = overall.amountMinor - sumBaseMagnitude(rows, ctx);
    return scalar(ctx, this.id, this.label, 'money', Math.trunc(left / remaining), rows);
  },
};

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

const uncategorizedRatio: MetricDefinition = {
  id: 'uncategorized_ratio',
  label: 'Uncategorised spending',
  unit: 'ratio',
  returns: 'scalar',
  description:
    'Share of spending with no category. A high number means every other figure on the ' +
    'page is less trustworthy than it looks.',
  compute(ctx) {
    const rows = expenseRows(ctx.transactions);
    const total = sumBaseMagnitude(rows, ctx);
    if (total === 0) {
      return scalar(ctx, this.id, this.label, 'ratio', null, rows, 'No spending in this period.');
    }
    const missing = rows.filter((txn) => txn.categoryId === null);
    return scalar(ctx, this.id, this.label, 'ratio', sumBaseMagnitude(missing, ctx) / total, missing);
  },
};

// ---------------------------------------------------------------------------

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  expenseTotal,
  incomeTotal,
  netCashFlow,
  savingsRate,
  categoryShare,
  topMerchants,
  spendByCurrency,
  fxExposure,
  momDelta,
  spendByMonth,
  budgetVariance,
  dailyAllowance,
  uncategorizedRatio,
  recurringDetected,
  subscriptionTotal,
  priceIncreaseAlert,
  largeAnomalies,
  rollingAvg,
  deductibleTotal,
  categoryExport,
];
