import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayCount,
  elapsedDays,
  isIsoDate,
  monthKey,
  monthKeysIn,
  monthOf,
  period,
  previousPeriod,
  previousYear,
  remainingDays,
  weekday,
} from '@kiwi/core';

describe('isIsoDate', () => {
  it('rejects dates that do not exist even though they parse', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });
});

describe('period', () => {
  it('counts days inclusively', () => {
    expect(dayCount(period('2026-03-01', '2026-03-31'))).toBe(31);
    expect(dayCount(period('2026-03-01', '2026-03-01'))).toBe(1);
  });

  it('refuses a period that ends before it starts', () => {
    expect(() => period('2026-03-31', '2026-03-01')).toThrow(RangeError);
  });

  it('places the previous period immediately before, at equal length', () => {
    const march = period('2026-03-01', '2026-03-31');
    const before = previousPeriod(march);
    expect(before.to).toBe('2026-02-28');
    expect(dayCount(before)).toBe(31);
  });

  it('shifts a year back and clamps a leap day', () => {
    expect(previousYear(period('2028-02-29', '2028-02-29')).from).toBe('2027-02-28');
  });
});

describe('month helpers', () => {
  it('finds the containing month, including February in a leap year', () => {
    expect(monthOf('2026-03-15')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(monthOf('2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('lists the months a period touches, in order and across a year boundary', () => {
    expect(monthKeysIn(period('2026-11-15', '2027-02-03'))).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('keys by month', () => {
    expect(monthKey('2026-03-15')).toBe('2026-03');
  });
});

describe('elapsed and remaining days', () => {
  const march = period('2026-03-01', '2026-03-31');

  it('counts today as both elapsed and remaining, so an allowance includes today', () => {
    expect(elapsedDays(march, '2026-03-21')).toBe(21);
    expect(remainingDays(march, '2026-03-21')).toBe(11);
    expect(elapsedDays(march, '2026-03-21') + remainingDays(march, '2026-03-21')).toBe(32);
  });

  it('clamps outside the period', () => {
    expect(elapsedDays(march, '2026-02-01')).toBe(0);
    expect(remainingDays(march, '2026-02-01')).toBe(31);
    expect(elapsedDays(march, '2026-04-01')).toBe(31);
    expect(remainingDays(march, '2026-04-01')).toBe(0);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('reports ISO weekdays with Sunday as 7', () => {
    expect(weekday('2026-03-01')).toBe(7);
    expect(weekday('2026-03-02')).toBe(1);
  });
});
