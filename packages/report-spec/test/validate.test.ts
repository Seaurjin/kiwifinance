import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_SCHEMA, SpecValidationError, parseSpec, validateSpec } from '@kiwi/report-spec';

const valid = {
  version: 1,
  title: 'March review',
  period: { from: '2026-03-01', to: '2026-03-31', compareTo: 'previous_period' },
  baseCurrency: 'SGD',
  fxMode: 'transaction',
  filters: { currencies: ['SGD', 'CNY'], excludeCategoryIds: ['cat-flights'] },
  blocks: [
    { type: 'metric_row', metrics: ['expense_total', 'savings_rate', 'fx_exposure'] },
    { type: 'chart', viz: 'stacked_bar', metric: 'category_share' },
    { type: 'table', metric: 'top_merchants', limit: 5 },
    { type: 'narrative', focus: ['anomalies', 'fx_exposure'] },
  ],
} as const;

const withBlocks = (blocks: unknown[]) => ({ ...valid, blocks });

describe('a well-formed spec', () => {
  it('passes both gates', () => {
    expect(validateSpec(valid)).toEqual([]);
    expect(parseSpec(valid).title).toBe('March review');
  });

  it('is published as a JSON Schema that a planner can be handed', () => {
    expect(REPORT_SPEC_SCHEMA).toMatchObject({ $id: expect.stringContaining('report-spec') });
  });
});

describe('structural rejection', () => {
  it('rejects an unknown field rather than ignoring it', () => {
    const violations = validateSpec({ ...valid, cleverness: true });
    expect(violations[0]?.message).toMatch(/Unknown field "cleverness"/);
  });

  it('rejects a spec with no blocks', () => {
    expect(validateSpec(withBlocks([]))).not.toEqual([]);
  });

  it('rejects an unknown block type', () => {
    expect(validateSpec(withBlocks([{ type: 'freeform', text: 'hi' }]))).not.toEqual([]);
  });

  it('rejects an unknown visualisation', () => {
    const violations = validateSpec(
      withBlocks([{ type: 'chart', viz: 'sankey', metric: 'category_share' }]),
    );
    expect(violations).not.toEqual([]);
  });

  it('rejects a malformed currency code', () => {
    expect(validateSpec({ ...valid, baseCurrency: 'dollars' })).not.toEqual([]);
  });
});

describe('semantic rejection', () => {
  it('rejects an invented metric and lists what is available', () => {
    const violations = validateSpec(
      withBlocks([{ type: 'metric_row', metrics: ['expense_total', 'vibes_index'] }]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe('/blocks/0/metrics/1');
    expect(violations[0]?.message).toMatch(/Unknown metric "vibes_index"/);
    expect(violations[0]?.message).toMatch(/expense_total/);
  });

  it('rejects a date that parses but does not exist', () => {
    const violations = validateSpec({ ...valid, period: { from: '2026-02-30', to: '2026-03-31' } });
    expect(violations[0]?.path).toBe('/period/from');
  });

  it('rejects a period that ends before it starts', () => {
    const violations = validateSpec({ ...valid, period: { from: '2026-03-31', to: '2026-03-01' } });
    expect(violations.some((v) => v.path === '/period')).toBe(true);
  });

  it('rejects a scalar metric placed in a chart, and says what to do instead', () => {
    const violations = validateSpec(
      withBlocks([{ type: 'chart', viz: 'bar', metric: 'savings_rate' }]),
    );
    expect(violations[0]?.message).toMatch(/cannot fill a chart block/);
    expect(violations[0]?.message).toMatch(/metric_row/);
  });

  it('rejects a series metric placed in a metric row', () => {
    const violations = validateSpec(
      withBlocks([{ type: 'metric_row', metrics: ['category_share'] }]),
    );
    expect(violations[0]?.message).toMatch(/cannot sit in a metric_row/);
  });
});

describe('parseSpec', () => {
  it('throws rather than degrading, and names every violation', () => {
    let thrown: unknown;
    try {
      parseSpec(withBlocks([{ type: 'metric_row', metrics: ['nope', 'also_nope'] }]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SpecValidationError);
    expect((thrown as SpecValidationError).violations).toHaveLength(2);
  });
});
