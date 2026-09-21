/**
 * Detection metrics.
 *
 * Recurring charges and anomalies are rules, not guesses, so they can be
 * asserted exactly — including the cases they must NOT fire on, which is where
 * a detector usually goes wrong.
 */

import { period, type Period } from '@kiwi/core';
import { DEMO_PERIOD, DEMO_TODAY, demoSnapshot, type LedgerSnapshot, type Transaction } from '@kiwi/ledger';
import { detectRecurring, runMetric, type RunOptions, type ScalarFact, type SeriesFact } from '@kiwi/metrics';
import { buildContext } from '@kiwi/metrics';
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

describe('recurring charges', () => {
  it('finds a monthly subscription from its cadence, not its name', () => {
    const charges = detectRecurring(buildContext(options));
    const netflix = charges.find((charge) => charge.merchant === 'Netflix');

    expect(netflix).toBeDefined();
    expect(netflix?.cadence).toBe('monthly');
    expect(netflix?.occurrences).toBe(4);
    expect(netflix?.medianGapDays).toBe(30);
    // The latest charge, 22.98, is what it costs each month.
    expect(netflix?.monthlyEquivalent).toBe(2_298);
  });

  it('does not call two charges a pattern', () => {
    // FairPrice appears twice in the fixture, which is a coincidence.
    const merchants = detectRecurring(buildContext(options)).map((c) => c.merchant);
    expect(merchants).not.toContain('FairPrice');
    expect(merchants).not.toContain('Employer');
  });

  it('totals what recurring charges cost in a month', () => {
    expect(scalarOf('subscription_total').value).toBe(2_298);
  });

  it('flags the price rise and reports how big it was', () => {
    const rows = seriesOf('price_increase_alert').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Netflix');
    // 22.98 less the 19.98 before it.
    expect(rows[0]?.value).toBe(300);
    // Both charges are cited, since the rise is not visible from one alone.
    expect(rows[0]?.sourceTxnIds).toHaveLength(2);
  });

  it('cites every charge in the series, so the figure can be opened up', () => {
    const rows = seriesOf('recurring_detected').rows;
    expect(rows.find((row) => row.key === 'netflix')?.sourceTxnIds).toEqual([
      't20',
      't21',
      't22',
      't23',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Anomalies need a fixture with a settled norm, so they get their own.
// ---------------------------------------------------------------------------

function fixtureWithGroceryHistory(): { snapshot: LedgerSnapshot; window: Period } {
  const base = demoSnapshot();
  const template = base.transactions[0] as Transaction;

  const row = (id: string, date: string, amountMinor: number): Transaction => ({
    ...template,
    id,
    date,
    amountMinor,
    baseAmountMinor: amountMinor,
    currency: 'SGD',
    fxRate: 1,
    categoryId: 'cat-groceries',
    merchantName: 'Corner Shop',
    status: 'confirmed',
    deletedAt: null,
  });

  const history: Transaction[] = [
    row('h1', '2026-01-05', -6_000),
    row('h2', '2026-01-12', -5_500),
    row('h3', '2026-01-19', -6_500),
    row('h4', '2026-01-26', -6_000),
  ];

  const inPeriod: Transaction[] = [
    row('normal', '2026-04-04', -6_200),
    // Nine times the usual weekly shop.
    row('outlier', '2026-04-11', -54_000),
    // Large in absolute terms but not against this category's norm.
    row('belowFloor', '2026-04-18', -4_000),
  ];

  return {
    snapshot: { ...base, transactions: [...history, ...inPeriod] },
    window: period('2026-04-01', '2026-04-30'),
  };
}

describe('unusual spending', () => {
  const { snapshot, window } = fixtureWithGroceryHistory();
  const anomalyOptions: RunOptions = { snapshot, period: window, today: '2026-04-30' };

  it('flags a charge far above its category’s own median', () => {
    const rows = (runMetric('large_anomalies', anomalyOptions) as SeriesFact).rows;
    expect(rows.map((row) => row.key)).toEqual(['outlier']);
    expect(rows[0]?.value).toBe(54_000);
  });

  it('says how far out it is, rather than just that it is out', () => {
    const rows = (runMetric('large_anomalies', anomalyOptions) as SeriesFact).rows;
    expect(rows[0]?.label).toMatch(/9\.0× usual/);
  });

  it('does not flag an ordinary charge', () => {
    const rows = (runMetric('large_anomalies', anomalyOptions) as SeriesFact).rows;
    expect(rows.map((row) => row.key)).not.toContain('normal');
  });

  it('stays quiet when a category has too little history to have a norm', () => {
    // The demo ledger's travel category holds one row, so 270.00 is not yet
    // "unusual" — it is simply the only thing we have seen.
    const rows = seriesOf('large_anomalies').rows;
    expect(rows.map((row) => row.label).join(' ')).not.toMatch(/JAL/);
  });
});

describe('rolling average', () => {
  it('averages the six months before the period, not the period itself', () => {
    const fact = scalarOf('rolling_avg');
    expect(fact.value).not.toBeNull();
    // Spending before March is the two February rows plus December's charge.
    expect(fact.sourceTxnIds).toEqual(expect.arrayContaining(['t13', 't14']));
    expect(fact.sourceTxnIds).not.toContain('t1');
  });

  it('says why when there is nothing before the period', () => {
    const fact = scalarOf('rolling_avg', { period: period('2025-01-01', '2025-01-31') });
    expect(fact.value).toBeNull();
    expect(fact.unavailableReason).toMatch(/before this period/);
  });
});

describe('tax preparation', () => {
  it('counts only what the user tagged, and claims nothing on their behalf', () => {
    expect(scalarOf('deductible_total').value).toBe(0);

    const snapshot = demoSnapshot();
    const tagged = {
      ...snapshot,
      transactions: snapshot.transactions.map((txn) =>
        txn.id === 't2' ? { ...txn, tags: ['deductible'] } : txn,
      ),
    };
    expect(scalarOf('deductible_total', { snapshot }).value).toBe(0);
    expect(scalarOf('deductible_total', { snapshot: tagged }).value).toBe(8_850);
  });

  it('breaks spending down by leaf category, not rolled up', () => {
    const rows = seriesOf('category_export').rows;
    // Groceries and Restaurants stay apart here, unlike in category_share.
    expect(rows.map((row) => row.label)).toEqual(
      expect.arrayContaining(['Groceries', 'Restaurants', 'Flights', 'Uncategorised']),
    );
    const groceries = rows.find((row) => row.label === 'Groceries');
    expect(groceries?.value).toBe(4_500 + 3_906);
  });
});
