import { DEMO_TODAY, demoSnapshot } from '@kiwi/ledger';
import type { ScalarFact, SeriesFact } from '@kiwi/metrics';
import { executeSpec, type FactSet } from '@kiwi/report-spec';
import { describe, expect, it } from 'vitest';

const spec = {
  version: 1,
  title: 'March review',
  period: { from: '2026-03-01', to: '2026-03-31', compareTo: 'previous_period' },
  baseCurrency: 'SGD',
  blocks: [
    { type: 'metric_row', title: 'Headline', metrics: ['expense_total', 'savings_rate'] },
    { type: 'chart', viz: 'donut', metric: 'category_share' },
    { type: 'table', metric: 'top_merchants', limit: 2 },
    { type: 'narrative', focus: ['summary', 'fx_exposure'] },
  ],
};

const options = { snapshot: demoSnapshot(), today: DEMO_TODAY };
const run = (): FactSet => executeSpec(spec, options);

describe('executeSpec', () => {
  const factSet = run();

  it('carries the basis every figure was computed under', () => {
    expect(factSet.basis).toMatchObject({
      baseCurrency: 'SGD',
      fxMode: 'transaction',
      period: { from: '2026-03-01', to: '2026-03-31' },
    });
  });

  it('gives each block a stable id', () => {
    expect(factSet.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('computes the metric row', () => {
    const [expenseTotal, savingsRate] = factSet.blocks[0]!.facts as ScalarFact[];
    expect(expenseTotal?.value).toBe(47_456);
    expect(expenseTotal?.currency).toBe('SGD');
    expect(savingsRate?.unit).toBe('ratio');
  });

  it('honours a table limit passed as a block field', () => {
    const table = factSet.blocks[2]!.facts[0] as SeriesFact;
    expect(table.rows).toHaveLength(2);
  });

  it('keeps the visualisation choice with the block, not with the numbers', () => {
    expect(factSet.blocks[1]!.viz).toBe('donut');
    expect(factSet.blocks[0]!.viz).toBeUndefined();
  });

  it('passes the narrative focus through without attaching figures to it', () => {
    expect(factSet.blocks[3]!.focus).toEqual(['summary', 'fx_exposure']);
    expect(factSet.blocks[3]!.facts).toEqual([]);
  });

  it('computes the comparison period alongside', () => {
    expect(factSet.comparisonPeriod).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    const prior = factSet.blocks[0]!.comparisonFacts?.[0] as ScalarFact;
    expect(prior.value).toBe(18_000);
  });

  it('is reproducible: the same spec and snapshot give an identical fact set', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('does not read the clock', () => {
    const later = executeSpec(spec, { ...options, generatedAt: '2030-01-01T00:00:00.000Z' });
    expect(later.blocks[0]!.facts).toEqual(factSet.blocks[0]!.facts);
  });

  it('rejects an invalid spec before computing anything', () => {
    expect(() => executeSpec({ ...spec, blocks: [{ type: 'chart', viz: 'bar', metric: 'nope' }] }, options)).toThrow(
      /Unknown metric "nope"/,
    );
  });

  it('omits the comparison when the spec did not ask for one', () => {
    const { compareTo: _ignored, ...withoutCompare } = spec.period as Record<string, unknown>;
    const plain = executeSpec({ ...spec, period: withoutCompare }, options);
    expect(plain.comparisonPeriod).toBeUndefined();
    expect(plain.blocks[0]!.comparisonFacts).toBeUndefined();
  });
});
