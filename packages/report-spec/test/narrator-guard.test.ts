/**
 * The guard that makes FR-ANA-06 enforceable rather than aspirational.
 *
 * The model is told to cite only the fact set. This is what happens when it
 * does not.
 */

import { DEMO_TODAY, demoSnapshot } from '@kiwi/ledger';
import {
  NarrativeNotGroundedError,
  allowedValues,
  assertNarrativeCitesOnlyFacts,
  executeSpec,
  findUncitedNumbers,
} from '@kiwi/report-spec';
import { describe, expect, it } from 'vitest';

const factSet = executeSpec(
  {
    version: 1,
    title: 'March review',
    period: { from: '2026-03-01', to: '2026-03-31' },
    baseCurrency: 'SGD',
    blocks: [
      { type: 'metric_row', metrics: ['expense_total', 'income_total', 'net_cash_flow'] },
      { type: 'metric_row', metrics: ['fx_exposure'] },
      { type: 'chart', viz: 'donut', metric: 'category_share' },
    ],
  },
  { snapshot: demoSnapshot(), today: DEMO_TODAY },
);

// Spending was 474.56 SGD; travel was 270.00 of it, a 56.9% share.

describe('grounded narratives', () => {
  it('accepts the exact figure', () => {
    expect(findUncitedNumbers('You spent 474.56 SGD in March.', factSet)).toEqual([]);
  });

  it('accepts the figure rounded to the precision the writer chose', () => {
    expect(findUncitedNumbers('You spent about 475 SGD.', factSet)).toEqual([]);
    expect(findUncitedNumbers('You spent about 474.6 SGD.', factSet)).toEqual([]);
  });

  it('accepts thousands separators and currency symbols', () => {
    expect(findUncitedNumbers('Income was $6,500.00 this month.', factSet)).toEqual([]);
  });

  it('accepts a share written as a percentage', () => {
    expect(findUncitedNumbers('Travel was 57% of your spending.', factSet)).toEqual([]);
  });

  it('accepts the sign flipped, since prose says "spent 474.56" for a negative flow', () => {
    expect(findUncitedNumbers('Net flow was 602,544 minor units.', factSet)).toEqual([]);
  });

  it('accepts dates from the reporting period', () => {
    expect(findUncitedNumbers('Between 2026-03-01 and 2026-03-31.', factSet)).toEqual([]);
    expect(findUncitedNumbers('In March 2026 you spent 474.56 SGD.', factSet)).toEqual([]);
  });
});

describe('ungrounded narratives', () => {
  it('catches a plausible but invented figure', () => {
    const violations = findUncitedNumbers('You spent 480.00 SGD in March.', factSet);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe('480.00');
  });

  it('catches an invented percentage', () => {
    const violations = findUncitedNumbers('Travel was 61% of your spending.', factSet);
    expect(violations[0]?.message).toMatch(/share/);
  });

  it('catches a figure that is right for another period', () => {
    // 180.00 is February's total, and this fact set does not contain it.
    expect(findUncitedNumbers('You spent 180.00 SGD.', factSet)).toHaveLength(1);
  });

  it('reports every offending number, not just the first', () => {
    const violations = findUncitedNumbers('You spent 480 on food and 999 on travel.', factSet);
    expect(violations.map((v) => v.token)).toEqual(['480', '999']);
  });

  it('throws with every violation named', () => {
    let thrown: unknown;
    try {
      assertNarrativeCitesOnlyFacts('Spending rose to 999.99 SGD.', factSet);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NarrativeNotGroundedError);
    expect((thrown as NarrativeNotGroundedError).violations).toHaveLength(1);
    expect((thrown as Error).message).toMatch(/999\.99/);
  });
});

describe('options', () => {
  it('can be loosened for counting words', () => {
    // 3 is the row count of the category series, so it passes on its own.
    expect(findUncitedNumbers('Across 3 categories.', factSet)).toHaveLength(0);
    expect(findUncitedNumbers('Across 9 categories.', factSet)).toHaveLength(1);
    expect(
      findUncitedNumbers('Across 9 categories.', factSet, { allowSmallIntegers: true }),
    ).toHaveLength(0);
  });

  it('documents the collision the loosening exists for', () => {
    // The uncategorised share is 6.74%, which rounds to 7 — so a bare "7"
    // passes even in strict mode. Small integers are genuinely ambiguous, which
    // is why allowSmallIntegers is off by default and narrow when on.
    expect(findUncitedNumbers('7 of something.', factSet)).toEqual([]);
  });

  it('accepts values the caller explicitly vouches for', () => {
    expect(findUncitedNumbers('Your 2027 goal is 5000.', factSet, { extraAllowed: [2027, 5000] })).toEqual([]);
  });
});

describe('allowedValues', () => {
  it('derives from the fact set alone', () => {
    const values = allowedValues(factSet);
    expect(values).toContain(47_456); // minor units
    expect(values).toContain(474.56); // major units
    expect(values).toContain(-474.56); // the same figure as an outflow
  });
});
