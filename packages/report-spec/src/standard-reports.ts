/**
 * The built-in reports (FR-ANA-03).
 *
 * Each is a Report Spec with its period left open — exactly the shape a user's
 * saved report takes, so the built-ins and a user's own reports run through the
 * identical path. There is no second, privileged rendering route.
 *
 * All eight the PRD names are here. The three that were waiting on metrics —
 * subscription audit, unusual spending, tax pack — now have them: recurring
 * charges, anomalies against a category's own median, and a tag-driven
 * deductible total, all deterministic.
 */

import type { ReportSpec, SpecBlock, SpecPeriod } from './types.ts';

export type StandardReportId =
  | 'monthly_review'
  | 'fx_exposure'
  | 'budget_replan'
  | 'travel_settlement'
  | 'year_in_review'
  | 'subscription_audit'
  | 'large_anomalies'
  | 'tax_pack';

export interface StandardReport {
  readonly id: StandardReportId;
  readonly title: string;
  readonly description: string;
  /** Builds a runnable spec for a concrete period. */
  build(period: SpecPeriod, baseCurrency?: string): ReportSpec;
}

function spec(
  title: string,
  period: SpecPeriod,
  blocks: SpecBlock[],
  baseCurrency?: string,
  filters?: ReportSpec['filters'],
): ReportSpec {
  return {
    version: 1,
    title,
    period,
    blocks,
    ...(baseCurrency !== undefined ? { baseCurrency } : {}),
    ...(filters !== undefined ? { filters } : {}),
  };
}

export const STANDARD_REPORTS: readonly StandardReport[] = [
  {
    id: 'monthly_review',
    title: 'Monthly review',
    description: 'Where the money went this month, and what changed since last month.',
    build: (period, baseCurrency) =>
      spec(
        'Monthly review',
        { ...period, compareTo: 'previous_period' },
        [
          { type: 'metric_row', title: 'Headline', metrics: ['expense_total', 'income_total', 'savings_rate'] },
          { type: 'chart', title: 'By category', viz: 'bar', metric: 'category_share' },
          { type: 'table', title: 'Top merchants', metric: 'top_merchants', limit: 8 },
          { type: 'narrative', focus: ['summary', 'trends', 'anomalies'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'fx_exposure',
    title: 'Cross-border & FX exposure',
    description: 'How much of your spending moves with exchange rates, and in which currencies.',
    build: (period, baseCurrency) =>
      spec(
        'Cross-border & FX exposure',
        period,
        [
          { type: 'metric_row', title: 'Exposure', metrics: ['fx_exposure', 'expense_total'] },
          { type: 'chart', title: 'By currency', viz: 'bar', metric: 'spend_by_currency' },
          { type: 'narrative', focus: ['fx_exposure', 'summary'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'budget_replan',
    title: 'Budget re-plan',
    description: 'What is left, and what that leaves you per day for the rest of the period.',
    build: (period, baseCurrency) =>
      spec(
        'Budget re-plan',
        period,
        [
          { type: 'metric_row', title: 'Remaining', metrics: ['daily_allowance', 'expense_total'] },
          { type: 'chart', title: 'Budget variance', viz: 'bar', metric: 'budget_variance' },
          { type: 'narrative', focus: ['budget'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'travel_settlement',
    title: 'Trip settlement',
    description: 'What a trip cost, across every currency it was paid in.',
    build: (period, baseCurrency) =>
      spec(
        'Trip settlement',
        period,
        [
          { type: 'metric_row', title: 'Trip total', metrics: ['expense_total', 'fx_exposure'] },
          { type: 'chart', title: 'By currency', viz: 'bar', metric: 'spend_by_currency' },
          { type: 'table', title: 'Where it went', metric: 'top_merchants', limit: 15 },
          { type: 'narrative', focus: ['summary', 'fx_exposure'] },
        ],
        baseCurrency,
        { tags: ['travel'] },
      ),
  },
  {
    id: 'year_in_review',
    title: 'Year in review',
    description: 'A full year of cash flow, month by month.',
    build: (period, baseCurrency) =>
      spec(
        'Year in review',
        { ...period, compareTo: 'previous_year' },
        [
          { type: 'metric_row', title: 'The year', metrics: ['expense_total', 'income_total', 'net_cash_flow'] },
          { type: 'chart', title: 'Month by month', viz: 'line', metric: 'spend_by_month' },
          { type: 'table', title: 'Top merchants', metric: 'top_merchants', limit: 10 },
          { type: 'narrative', focus: ['summary', 'trends'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'subscription_audit',
    title: 'Subscription audit',
    description: 'What you pay on a repeating schedule, and which of those went up.',
    build: (period, baseCurrency) =>
      spec(
        'Subscription audit',
        period,
        [
          { type: 'metric_row', title: 'Every month', metrics: ['subscription_total', 'expense_total'] },
          { type: 'chart', title: 'Recurring charges', viz: 'bar', metric: 'recurring_detected' },
          { type: 'table', title: 'Went up', metric: 'price_increase_alert' },
          { type: 'narrative', focus: ['subscriptions'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'large_anomalies',
    title: 'Unusual spending',
    description: 'Charges far larger than normal for their category.',
    build: (period, baseCurrency) =>
      spec(
        'Unusual spending',
        period,
        [
          { type: 'metric_row', title: 'Against normal', metrics: ['rolling_avg', 'expense_total'] },
          { type: 'table', title: 'Stands out', metric: 'large_anomalies' },
          { type: 'narrative', focus: ['anomalies'] },
        ],
        baseCurrency,
      ),
  },
  {
    id: 'tax_pack',
    title: 'Tax preparation pack',
    description: 'What you tagged as claimable, and the exact-category breakdown to go with it.',
    build: (period, baseCurrency) =>
      spec(
        'Tax preparation pack',
        period,
        [
          { type: 'metric_row', title: 'Claimable', metrics: ['deductible_total', 'expense_total'] },
          { type: 'table', title: 'By exact category', metric: 'category_export', limit: 100 },
          { type: 'narrative', focus: ['summary', 'data_quality'] },
        ],
        baseCurrency,
      ),
  },
];

/**
 * Nothing is pending any more. Kept so the API's shape does not change and a
 * future report waiting on a metric has somewhere to be declared.
 */
export const PENDING_REPORTS: readonly { id: string; title: string; needs: string[] }[] = [];

export function standardReport(id: string): StandardReport | undefined {
  return STANDARD_REPORTS.find((report) => report.id === id);
}
