/**
 * Time phrases.
 *
 * These are the assertions that keep a report honest about *when*: a period
 * that is off by a month is not a smaller error than a figure that is wrong,
 * it is the same error one layer up.
 */

import { describe, expect, it } from 'vitest';
import { parseCount, resolveComparison, resolveWindow } from '@kiwi/planner';

const TODAY = '2026-09-21';

describe('resolveWindow', () => {
  it('defaults to this month and says that it assumed it', () => {
    const window = resolveWindow('what did I spend on food', TODAY);
    expect(window).toMatchObject({ from: '2026-09-01', to: '2026-09-30', explicit: false });
  });

  it('reads "last month" as the whole previous calendar month', () => {
    expect(resolveWindow('last month', TODAY)).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
      label: 'August 2026',
      explicit: true,
    });
  });

  it('crosses the year boundary going backwards', () => {
    expect(resolveWindow('上个月', '2026-01-09')).toMatchObject({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('takes a named month without a year as the most recent one that happened', () => {
    expect(resolveWindow('in March', TODAY)).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    // November has not happened in 2026 yet, so it means 2025's.
    expect(resolveWindow('november', TODAY)).toMatchObject({ from: '2025-11-01', to: '2025-11-30' });
  });

  it('counts rolling day windows inclusively', () => {
    const window = resolveWindow('the last 90 days', TODAY);
    expect(window).toMatchObject({ from: '2026-06-24', to: '2026-09-21' });
  });

  it('rounds a "last N months" window to whole calendar months', () => {
    // Otherwise a by-month chart opens and closes on a half month.
    expect(resolveWindow('past 3 months', TODAY)).toMatchObject({
      from: '2026-07-01',
      to: '2026-09-30',
    });
  });

  it('reads Chinese numerals', () => {
    expect(parseCount('三')).toBe(3);
    expect(parseCount('十二')).toBe(12);
    expect(parseCount('二十四')).toBe(24);
    expect(parseCount('好几')).toBeNull();
    expect(resolveWindow('最近三个月', TODAY)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('handles quarters, including the one that wraps the year', () => {
    expect(resolveWindow('this quarter', TODAY)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolveWindow('last quarter', TODAY)).toMatchObject({ from: '2026-04-01', to: '2026-06-30' });
    expect(resolveWindow('上季度', '2026-02-10')).toMatchObject({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('prefers an explicit date range over every phrase in the same sentence', () => {
    expect(resolveWindow('spending from 2026-01-15 to 2026-02-14, not this month', TODAY)).toMatchObject({
      from: '2026-01-15',
      to: '2026-02-14',
    });
  });

  it('reads year to date as ending today, not at the year end', () => {
    expect(resolveWindow('year to date', TODAY)).toMatchObject({ from: '2026-01-01', to: TODAY });
    expect(resolveWindow('this year', TODAY)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('does not read a bare year out of a date that was already understood', () => {
    expect(resolveWindow('2026-03', TODAY)).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(resolveWindow('2026年3月', TODAY)).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
  });
});

describe('resolveComparison', () => {
  it('finds a comparison only when one was asked for', () => {
    expect(resolveComparison('what did I spend')).toBeUndefined();
    expect(resolveComparison('spending vs last month')).toBe('previous_period');
    expect(resolveComparison('环比')).toBe('previous_period');
    expect(resolveComparison('year over year')).toBe('previous_year');
    expect(resolveComparison('同比')).toBe('previous_year');
  });
});
