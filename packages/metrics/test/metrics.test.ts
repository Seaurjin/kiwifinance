/**
 * Every expected figure below was worked out by hand from the golden dataset.
 * If one of these fails, the engine changed its mind about what a number means.
 */

import { period } from '@kiwi/core';
import { DEMO_PERIOD, DEMO_TODAY, demoSnapshot } from '@kiwi/ledger';
import {
  FxModeUnsupportedError,
  MetricRegistry,
  UnknownMetricError,
  defaultRegistry,
  runMetric,
  runMetrics,
  type RunOptions,
  type ScalarFact,
  type SeriesFact,
} from '@kiwi/metrics';
import { describe, expect, it } from 'vitest';

const options: RunOptions = {
  snapshot: demoSnapshot(),
  period: period(DEMO_PERIOD.from, DEMO_PERIOD.to),
  today: DEMO_TODAY,
};

const scalarOf = (id: string, overrides: Partial<RunOptions> = {}): ScalarFact =>
  runMetric(id, { ...options, ...overrides }) as ScalarFact;
const seriesOf = (id: string, overrides: Partial<RunOptions> = {}): SeriesFact =>
  runMetric(id, { ...options, ...overrides }) as SeriesFact;

// March spending, in SGD minor units:
//   45.00 groceries + 88.50 restaurants + 270.00 flights (JPY) +
//   39.06 groceries (CNY) + 32.00 uncategorised  =  474.56
const EXPENSE_TOTAL = 47_456;
const INCOME_TOTAL = 650_000;

describe('registry', () => {
  it('exposes the metric library', () => {
    expect(defaultRegistry.ids()).toHaveLength(20);
    expect(defaultRegistry.ids()).toContain('expense_total');
    // The metrics the three previously-pending standard reports were waiting on.
    for (const id of ['recurring_detected', 'large_anomalies', 'deductible_total']) {
      expect(defaultRegistry.ids()).toContain(id);
    }
  });

  it('rejects a metric it does not know rather than approximating one', () => {
    expect(() => runMetric('vibes_index', options)).toThrow(UnknownMetricError);
    expect(() => runMetric('vibes_index', options)).toThrow(/Known metrics:/);
  });

  it('refuses to register the same id twice', () => {
    const one = defaultRegistry.get('expense_total');
    expect(() => new MetricRegistry([one, one])).toThrow(/Duplicate metric id/);
  });

  it('publishes a catalogue with no implementation detail', () => {
    const entry = defaultRegistry.catalogue().find((m) => m.id === 'savings_rate');
    expect(entry).toMatchObject({ unit: 'ratio', returns: 'scalar' });
    expect(entry?.description).toMatch(/income/i);
  });
});

describe('cash flow', () => {
  it('totals spending, excluding transfers, FX legs, pending and deleted rows', () => {
    const fact = scalarOf('expense_total');
    expect(fact.value).toBe(EXPENSE_TOTAL);
    expect(fact.currency).toBe('SGD');
    expect(fact.sourceTxnIds).toEqual(['t1', 't2', 't3', 't4', 't6']);
  });

  it('totals income', () => {
    expect(scalarOf('income_total').value).toBe(INCOME_TOTAL);
  });

  it('nets income against spending', () => {
    expect(scalarOf('net_cash_flow').value).toBe(INCOME_TOTAL - EXPENSE_TOTAL);
  });

  it('computes a savings rate', () => {
    expect(scalarOf('savings_rate').value).toBeCloseTo(
      (INCOME_TOTAL - EXPENSE_TOTAL) / INCOME_TOTAL,
      10,
    );
  });

  it('reports savings rate as unavailable, with a reason, when there was no income', () => {
    const fact = scalarOf('savings_rate', { period: period('2026-02-01', '2026-02-28') });
    expect(fact.value).toBeNull();
    expect(fact.unavailableReason).toMatch(/No income/);
  });
});

describe('structure', () => {
  it('groups spending by top-level category, largest first, with shares', () => {
    const fact = seriesOf('category_share');
    expect(fact.rows.map((r) => [r.key, r.value])).toEqual([
      ['cat-travel', 27_000],
      ['cat-food', 17_256],
      ['__uncategorized', 3_200],
    ]);
    expect(fact.rows.reduce((total, r) => total + (r.value ?? 0), 0)).toBe(EXPENSE_TOTAL);
    expect(fact.rows[0]?.share).toBeCloseTo(27_000 / EXPENSE_TOTAL, 10);
  });

  it('ranks merchants and honours the limit parameter', () => {
    expect(seriesOf('top_merchants').rows.map((r) => [r.key, r.value])).toEqual([
      ['JAL', 27_000],
      ['Tiong Bahru Bakery', 8_850],
      ['FairPrice', 4_500],
      ['Hema', 3_906],
    ]);
    expect(seriesOf('top_merchants', { params: { limit: 2 } }).rows).toHaveLength(2);
  });

  it('rejects a parameter of the wrong type instead of coercing it', () => {
    expect(() => seriesOf('top_merchants', { params: { limit: 'ten' } })).toThrow(TypeError);
  });
});

describe('multi-currency', () => {
  it('groups by the currency actually spent, converted for comparison', () => {
    const fact = seriesOf('spend_by_currency');
    expect(fact.rows.map((r) => [r.key, r.value])).toEqual([
      ['JPY', 27_000],
      ['SGD', 16_550],
      ['CNY', 3_906],
    ]);
  });

  it('measures the share of spending exposed to exchange rates', () => {
    expect(scalarOf('fx_exposure').value).toBeCloseTo((27_000 + 3_906) / EXPENSE_TOTAL, 10);
  });
});

describe('FX mode', () => {
  it("defaults to the rate that actually happened", () => {
    const fact = runMetric('expense_total', options) as ScalarFact;
    expect(fact.value).toBe(EXPENSE_TOTAL);
  });

  it('re-converts at a common rate under reporting mode', () => {
    const reportingRates = new Map([
      ['JPY', 0.01],
      ['CNY', 0.2],
    ]);
    const fact = scalarOf('expense_total', { fxMode: 'reporting', reportingRates });
    // 30,000 JPY at 0.01 = 300.00; 210.00 CNY at 0.20 = 42.00; SGD rows unchanged.
    expect(fact.value).toBe(30_000 + 4_200 + 16_550);
  });

  it('refuses reporting mode without rates rather than silently mixing bases', () => {
    expect(() => scalarOf('expense_total', { fxMode: 'reporting' })).toThrow(FxModeUnsupportedError);
    expect(() => scalarOf('expense_total', { fxMode: 'reporting' })).toThrow(/reportingRates/);
  });
});

describe('time comparison', () => {
  it('compares against the equally long period immediately before', () => {
    // February holds 120.00 + 60.00 = 180.00 of spending.
    expect(scalarOf('mom_delta').value).toBe(EXPENSE_TOTAL - 18_000);
  });

  it('cites both periods, since the delta is not traceable from one alone', () => {
    expect(scalarOf('mom_delta').sourceTxnIds).toEqual(['t1', 't2', 't3', 't4', 't6', 't13', 't14']);
  });

  it('buckets spending by month, oldest first', () => {
    const fact = seriesOf('spend_by_month', { period: period('2026-02-01', '2026-03-31') });
    expect(fact.rows.map((r) => [r.key, r.value])).toEqual([
      ['2026-02', 18_000],
      ['2026-03', EXPENSE_TOTAL],
    ]);
  });
});

describe('budget', () => {
  it('reports what is left of each budget, worst first', () => {
    const fact = seriesOf('budget_variance');
    expect(fact.rows.map((r) => [r.label, r.value])).toEqual([
      ['Food & Drink', 30_000 - 17_256],
      ['Overall', 100_000 - EXPENSE_TOTAL],
    ]);
  });

  it('spreads what is left over the days that remain', () => {
    // 1,000.00 budget less 474.56 spent, over the 11 days from the 21st.
    expect(scalarOf('daily_allowance').value).toBe(Math.trunc((100_000 - EXPENSE_TOTAL) / 11));
  });

  it('says why, rather than showing a zero, when no overall budget exists', () => {
    const snapshot = { ...demoSnapshot(), budgets: [] };
    const fact = scalarOf('daily_allowance', { snapshot });
    expect(fact.value).toBeNull();
    expect(fact.unavailableReason).toMatch(/No overall budget/);
  });

  it('says why when the period has already ended', () => {
    const fact = scalarOf('daily_allowance', { today: '2026-04-15' });
    expect(fact.value).toBeNull();
    expect(fact.unavailableReason).toMatch(/already over/);
  });
});

describe('data quality', () => {
  it('measures the share of spending with no category', () => {
    expect(scalarOf('uncategorized_ratio').value).toBeCloseTo(3_200 / EXPENSE_TOTAL, 10);
    expect(scalarOf('uncategorized_ratio').sourceTxnIds).toEqual(['t6']);
  });
});

describe('filters', () => {
  it('restricts to named currencies', () => {
    const fact = scalarOf('expense_total', { filters: { currencies: ['SGD'] } });
    expect(fact.value).toBe(16_550);
  });

  it('excludes named categories', () => {
    const fact = scalarOf('expense_total', { filters: { excludeCategoryIds: ['cat-flights'] } });
    expect(fact.value).toBe(EXPENSE_TOTAL - 27_000);
  });

  it('restricts to an account', () => {
    expect(scalarOf('expense_total', { filters: { accountIds: ['acc-cny'] } }).value).toBe(3_906);
  });
});

describe('runMetrics', () => {
  it('shares one context, so every figure in a row has the same basis', () => {
    const facts = runMetrics(['expense_total', 'income_total', 'net_cash_flow'], options);
    expect(facts.map((f) => (f as ScalarFact).value)).toEqual([
      EXPENSE_TOTAL,
      INCOME_TOTAL,
      INCOME_TOTAL - EXPENSE_TOTAL,
    ]);
  });
});

describe('determinism', () => {
  it('returns byte-identical results across runs', () => {
    const first = JSON.stringify(runMetrics(defaultRegistry.ids(), options));
    const second = JSON.stringify(runMetrics(defaultRegistry.ids(), options));
    expect(first).toBe(second);
  });
});
