/**
 * The built-in reports (FR-ANA-03).
 *
 * Each is a Report Spec with its period left open — exactly the shape a user's
 * saved report takes, so the built-ins and a user's own reports run through the
 * identical path. There is no second, privileged rendering route.
 *
 * Five of the eight the PRD names are here. The other three
 * (subscription audit, large-anomaly review, tax pack) need metrics the v0
 * library does not have yet; they are listed in PENDING_REPORTS with what each
 * is waiting on, rather than shipped half-working.
 */

import type { ReportSpec, SpecBlock, SpecPeriod } from './types.ts';

export type StandardReportId =
  | 'monthly_review'
  | 'fx_exposure'
  | 'budget_replan'
  | 'travel_settlement'
  | 'year_in_review';

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
];

/** The remaining three, and the metric each is waiting on. */
export const PENDING_REPORTS: readonly { id: string; title: string; needs: string[] }[] = [
  { id: 'subscription_audit', title: 'Subscription audit', needs: ['recurring_detected', 'subscription_total', 'price_increase_alert'] },
  { id: 'large_anomalies', title: 'Unusual spending', needs: ['anomaly_score', 'rolling_avg'] },
  { id: 'tax_pack', title: 'Tax preparation pack', needs: ['deductible_total', 'category_export'] },
];

export function standardReport(id: string): StandardReport | undefined {
  return STANDARD_REPORTS.find((report) => report.id === id);
}
