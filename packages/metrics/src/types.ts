/**
 * Metric contracts.
 *
 * PRD P-1: this package is the only producer of numbers in the system. A model
 * may choose *which* metric runs; it never computes the value and never sees a
 * path to invent one.
 *
 * Every result carries three things beyond the number itself:
 *   - `unit` and `currency`, so nothing downstream has to guess what it is;
 *   - `basis`, the period / FX mode / filters it was computed under, because a
 *     figure without its basis is not comparable to anything;
 *   - `sourceTxnIds`, so any figure can be expanded to the rows behind it
 *     (FR-ANA-05).
 */

import type { CurrencyCode, FxMode, IsoDate, Period } from '@kiwi/core';
import type { Id, LedgerSnapshot, Transaction } from '@kiwi/ledger';

export type MetricId = string;

export type MetricUnit =
  /** Integer minor units of `currency`. */
  | 'money'
  /** Dimensionless fraction, 0.42 meaning 42%. */
  | 'ratio'
  | 'count'
  | 'days';

/** The conditions a figure was computed under. Travels with every fact. */
export interface Basis {
  readonly period: Period;
  readonly baseCurrency: CurrencyCode;
  readonly fxMode: FxMode;
  readonly filters: MetricFilters;
}

export interface MetricFilters {
  /** Restrict to these original currencies. Empty or absent means all. */
  readonly currencies?: readonly CurrencyCode[];
  readonly accountIds?: readonly Id[];
  readonly categoryIds?: readonly Id[];
  readonly excludeCategoryIds?: readonly Id[];
  readonly tags?: readonly string[];
}

export interface ScalarFact {
  readonly kind: 'scalar';
  readonly metric: MetricId;
  readonly label: string;
  readonly unit: MetricUnit;
  /** Minor units when `unit` is 'money'. Null when the metric is undefined here. */
  readonly value: number | null;
  readonly currency?: CurrencyCode;
  /** Why the value is null, when it is. */
  readonly unavailableReason?: string;
  readonly sourceTxnIds: readonly Id[];
}

export interface SeriesRow {
  /** Stable machine key: a category id, a currency code, a month. */
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  /** Share of the series total, when the metric defines one. */
  readonly share?: number;
  readonly sourceTxnIds: readonly Id[];
}

export interface SeriesFact {
  readonly kind: 'series';
  readonly metric: MetricId;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly currency?: CurrencyCode;
  readonly rows: readonly SeriesRow[];
  readonly sourceTxnIds: readonly Id[];
}

export type Fact = ScalarFact | SeriesFact;

/**
 * Everything a metric is allowed to see. No IO, no clock beyond `today`, no
 * randomness — which is what makes a report reproducible (FR-ANA-08).
 */
export interface MetricContext {
  readonly snapshot: LedgerSnapshot;
  readonly period: Period;
  readonly baseCurrency: CurrencyCode;
  readonly fxMode: FxMode;
  /** Injected rather than read from the system clock, so tests are stable. */
  readonly today: IsoDate;
  readonly filters: MetricFilters;
  /** Confirmed, non-deleted rows inside `period` that pass `filters`. */
  readonly transactions: readonly Transaction[];
  /**
   * Rates for converting original currencies into the base currency when
   * `fxMode` is 'reporting'. Keyed by original currency code.
   * Absent under 'transaction' mode, which uses each row's frozen rate.
   */
  readonly reportingRates?: ReadonlyMap<CurrencyCode, number>;
  /** Metric-specific arguments taken from the report spec. */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface MetricDefinition {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: MetricUnit;
  /** One line, shown to a model choosing metrics and to the user in the UI. */
  readonly description: string;
  readonly returns: 'scalar' | 'series';
  /** Parameters this metric accepts, for the spec schema and the tool surface. */
  readonly params?: Readonly<Record<string, { type: 'number' | 'string'; description: string }>>;
  compute(ctx: MetricContext): Fact;
}

export class UnknownMetricError extends Error {
  constructor(readonly metricId: string, known: readonly string[]) {
    super(
      `Unknown metric "${metricId}". A report spec may only name metrics from the registry. ` +
        `Known metrics: ${known.join(', ')}.`,
    );
    this.name = 'UnknownMetricError';
  }
}

export class FxModeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxModeUnsupportedError';
  }
}
