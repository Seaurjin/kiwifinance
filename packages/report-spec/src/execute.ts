/**
 * Executing a spec into a fact set.
 *
 * This is step 3 of the harness: the spec has been validated, and here the
 * deterministic engine turns it into numbers. Nothing in this file calls a
 * model, and nothing downstream of it may produce a figure that did not come
 * from here.
 */

import { period as makePeriod, previousPeriod, previousYear, type Period } from '@kiwi/core';
import type { LedgerSnapshot } from '@kiwi/ledger';
import {
  basisOf,
  buildContext,
  defaultRegistry,
  type Fact,
  type MetricRegistry,
  type RunOptions,
} from '@kiwi/metrics';
import { parseSpec } from './validate.ts';
import type { FactBlock, FactSet, ReportSpec, SpecBlock } from './types.ts';

export interface ExecuteOptions {
  readonly snapshot: LedgerSnapshot;
  /** Injected so a report run twice returns the same thing (FR-ANA-08). */
  readonly today: string;
  readonly reportingRates?: ReadonlyMap<string, number>;
  /** Stamped onto the fact set; also injected rather than read from the clock. */
  readonly generatedAt?: string;
}

function comparisonPeriodFor(spec: ReportSpec, base: Period): Period | null {
  switch (spec.period.compareTo) {
    case 'previous_period':
      return previousPeriod(base);
    case 'previous_year':
      return previousYear(base);
    default:
      return null;
  }
}

function runOptionsFor(
  spec: ReportSpec,
  options: ExecuteOptions,
  target: Period,
  params: Readonly<Record<string, unknown>>,
): RunOptions {
  return {
    snapshot: options.snapshot,
    period: target,
    today: options.today,
    params,
    ...(spec.baseCurrency !== undefined ? { baseCurrency: spec.baseCurrency } : {}),
    ...(spec.fxMode !== undefined ? { fxMode: spec.fxMode } : {}),
    ...(spec.filters !== undefined ? { filters: spec.filters } : {}),
    ...(options.reportingRates !== undefined ? { reportingRates: options.reportingRates } : {}),
  };
}

function blockParams(block: SpecBlock): Record<string, unknown> {
  if (block.type === 'table') {
    return { ...block.params, ...(block.limit !== undefined ? { limit: block.limit } : {}) };
  }
  if (block.type === 'chart') return { ...block.params };
  return {};
}

function metricsOf(block: SpecBlock): string[] {
  switch (block.type) {
    case 'metric_row':
      return [...block.metrics];
    case 'chart':
    case 'table':
      return [block.metric];
    case 'narrative':
      return [];
  }
}

export function executeSpec(
  input: unknown,
  options: ExecuteOptions,
  registry: MetricRegistry = defaultRegistry,
): FactSet {
  const spec = parseSpec(input, registry);
  const base = makePeriod(spec.period.from, spec.period.to);
  const comparison = comparisonPeriodFor(spec, base);

  const blocks: FactBlock[] = spec.blocks.map((block, index) => {
    const params = blockParams(block);
    const ids = metricsOf(block);

    const ctx = buildContext(runOptionsFor(spec, options, base, params));
    const facts: Fact[] = ids.map((id) => registry.get(id).compute(ctx));

    let comparisonFacts: Fact[] | undefined;
    if (comparison !== null && ids.length > 0) {
      const comparisonCtx = buildContext(runOptionsFor(spec, options, comparison, params));
      comparisonFacts = ids.map((id) => registry.get(id).compute(comparisonCtx));
    }

    return {
      id: `b${index + 1}`,
      type: block.type,
      facts,
      ...(block.title !== undefined ? { title: block.title } : {}),
      ...(block.type === 'chart' ? { viz: block.viz } : {}),
      ...(block.type === 'narrative' && block.focus !== undefined ? { focus: block.focus } : {}),
      ...(comparisonFacts !== undefined ? { comparisonFacts } : {}),
    };
  });

  const referenceCtx = buildContext(runOptionsFor(spec, options, base, {}));

  return {
    specTitle: spec.title,
    basis: basisOf(referenceCtx),
    generatedAt: options.generatedAt ?? `${options.today}T00:00:00.000Z`,
    blocks,
    ...(comparison !== null ? { comparisonPeriod: comparison } : {}),
  };
}
