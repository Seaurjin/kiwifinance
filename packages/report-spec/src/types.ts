/**
 * TypeScript mirror of schema.json. The JSON Schema is the contract the model
 * is validated against; these types are the contract the rest of the code is
 * compiled against. They are kept in step by `schema.test.ts`.
 */

import type { CurrencyCode, FxMode, IsoDate, Period } from '@kiwi/core';
import type { Basis, Fact, MetricFilters } from '@kiwi/metrics';

export type CompareTo = 'previous_period' | 'previous_year';

export interface SpecPeriod {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly compareTo?: CompareTo;
}

export type Viz = 'bar' | 'stacked_bar' | 'line' | 'donut';

export type NarrativeFocus =
  | 'summary'
  | 'anomalies'
  | 'trends'
  | 'fx_exposure'
  | 'budget'
  | 'subscriptions'
  | 'data_quality';

export interface MetricRowBlock {
  readonly type: 'metric_row';
  readonly title?: string;
  readonly metrics: readonly string[];
}

export interface ChartBlock {
  readonly type: 'chart';
  readonly title?: string;
  readonly viz: Viz;
  readonly metric: string;
  readonly params?: Readonly<Record<string, number | string>>;
}

export interface TableBlock {
  readonly type: 'table';
  readonly title?: string;
  readonly metric: string;
  readonly limit?: number;
  readonly params?: Readonly<Record<string, number | string>>;
}

export interface NarrativeBlock {
  readonly type: 'narrative';
  readonly title?: string;
  readonly focus?: readonly NarrativeFocus[];
}

export type SpecBlock = MetricRowBlock | ChartBlock | TableBlock | NarrativeBlock;

export interface ReportSpec {
  readonly version: 1;
  readonly title: string;
  readonly period: SpecPeriod;
  readonly baseCurrency?: CurrencyCode;
  readonly fxMode?: FxMode;
  readonly filters?: MetricFilters;
  readonly blocks: readonly SpecBlock[];
}

// ---------------------------------------------------------------------------
// Execution output
// ---------------------------------------------------------------------------

export interface FactBlock {
  /** Stable within a fact set, so narrative can cite "block 2". */
  readonly id: string;
  readonly type: SpecBlock['type'];
  readonly title?: string;
  readonly viz?: Viz;
  readonly facts: readonly Fact[];
  /** Present on comparison blocks: the same facts for the comparison period. */
  readonly comparisonFacts?: readonly Fact[];
  /** Instruction for the narrator; carries no numbers. */
  readonly focus?: readonly NarrativeFocus[];
}

/**
 * The only thing a narrating model is given. Every number it may write appears
 * somewhere in here; `assertNarrativeCitesOnlyFacts` enforces that afterwards
 * (FR-ANA-06).
 */
export interface FactSet {
  readonly specTitle: string;
  readonly basis: Basis;
  readonly comparisonPeriod?: Period;
  /** Injected, not read from the clock, so a fact set is reproducible. */
  readonly generatedAt: string;
  readonly blocks: readonly FactBlock[];
}
