/**
 * The metric registry and runner.
 *
 * A report spec names metrics by id. The registry is a closed set: an id that
 * is not in it is rejected rather than approximated, which is how PRD P-1 stops
 * a model from inventing a measure and having it silently computed.
 */

import type { CurrencyCode, FxMode, IsoDate, Period } from '@kiwi/core';
import type { LedgerSnapshot } from '@kiwi/ledger';
import { METRIC_DEFINITIONS } from './definitions.ts';
import { selectTransactions } from './select.ts';
import {
  UnknownMetricError,
  type Basis,
  type Fact,
  type MetricContext,
  type MetricDefinition,
  type MetricFilters,
  type MetricId,
} from './types.ts';

export class MetricRegistry {
  readonly #byId: Map<MetricId, MetricDefinition>;

  constructor(definitions: readonly MetricDefinition[] = METRIC_DEFINITIONS) {
    this.#byId = new Map();
    for (const definition of definitions) {
      if (this.#byId.has(definition.id)) {
        throw new Error(`Duplicate metric id "${definition.id}" in the registry.`);
      }
      this.#byId.set(definition.id, definition);
    }
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  get(id: string): MetricDefinition {
    const definition = this.#byId.get(id);
    if (definition === undefined) throw new UnknownMetricError(id, this.ids());
    return definition;
  }

  ids(): string[] {
    return [...this.#byId.keys()].sort();
  }

  list(): MetricDefinition[] {
    return [...this.#byId.values()];
  }

  /**
   * The catalogue handed to a planning model and to `kiwi_list_schema` over
   * MCP: names, units and one-line descriptions, no implementation detail.
   */
  catalogue(): { id: string; label: string; unit: string; returns: string; description: string }[] {
    return this.list().map((definition) => ({
      id: definition.id,
      label: definition.label,
      unit: definition.unit,
      returns: definition.returns,
      description: definition.description,
    }));
  }
}

export const defaultRegistry = new MetricRegistry();

export interface RunOptions {
  readonly snapshot: LedgerSnapshot;
  readonly period: Period;
  /** Defaults to the ledger's base currency. */
  readonly baseCurrency?: CurrencyCode;
  /** Defaults to 'transaction' — the rate that actually happened (FR-LED-02). */
  readonly fxMode?: FxMode;
  /** Injected, never read from the clock, so reports are reproducible. */
  readonly today: IsoDate;
  readonly filters?: MetricFilters;
  readonly reportingRates?: ReadonlyMap<CurrencyCode, number>;
  readonly params?: Readonly<Record<string, unknown>>;
}

export function buildContext(options: RunOptions): MetricContext {
  const baseCurrency = options.baseCurrency ?? options.snapshot.ledger.baseCurrency;
  const fxMode: FxMode = options.fxMode ?? 'transaction';
  const filters = options.filters ?? {};

  return {
    snapshot: options.snapshot,
    period: options.period,
    baseCurrency,
    fxMode,
    today: options.today,
    filters,
    transactions: selectTransactions(options.snapshot, options.period, filters),
    params: options.params ?? {},
    ...(options.reportingRates !== undefined ? { reportingRates: options.reportingRates } : {}),
  };
}

export function basisOf(ctx: MetricContext): Basis {
  return {
    period: ctx.period,
    baseCurrency: ctx.baseCurrency,
    fxMode: ctx.fxMode,
    filters: ctx.filters,
  };
}

export function runMetric(
  id: string,
  options: RunOptions,
  registry: MetricRegistry = defaultRegistry,
): Fact {
  return registry.get(id).compute(buildContext(options));
}

export function runMetrics(
  ids: readonly string[],
  options: RunOptions,
  registry: MetricRegistry = defaultRegistry,
): Fact[] {
  // Build the context once: selecting rows is the expensive part, and sharing
  // it also guarantees every figure in a block shares one basis.
  const ctx = buildContext(options);
  return ids.map((id) => registry.get(id).compute(ctx));
}
