/**
 * Turning a time phrase into a period.
 *
 * "Last month" has one answer; "recently" has none. Where the question names
 * no window the planner takes the current month and *says so* — an assumption
 * the user can see is a correctable assumption, a silent one is a wrong
 * report that looks right.
 *
 * English and Chinese are both handled here rather than in a translation
 * layer, because the two markets are served by the same engine (PRD NFR-C-05
 * separates models, not meaning).
 */

import { addDays, monthOf, monthKey, type IsoDate } from '@kiwi/core';
import type { CompareTo } from '@kiwi/report-spec';

export interface Window {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** How the window will be named in the report title. */
  readonly label: string;
  /** False when the question named no period and the default was used. */
  readonly explicit: boolean;
}

const MONTH_NAMES: readonly string[] = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTH_LABELS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CN_DIGITS: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 三 → 3, 十二 → 12, 二十四 → 24. Anything else → null. */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const tenIndex = trimmed.indexOf('十');
  if (tenIndex === -1) {
    const single = CN_DIGITS[trimmed];
    return single ?? null;
  }
  const head = trimmed.slice(0, tenIndex);
  const tail = trimmed.slice(tenIndex + 1);
  const tens = head === '' ? 1 : CN_DIGITS[head];
  const units = tail === '' ? 0 : CN_DIGITS[tail];
  if (tens === undefined || units === undefined) return null;
  return tens * 10 + units;
}

const COUNT = '(\\d{1,3}|[一二两三四五六七八九十]{1,3})';

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthWindow(year: number, month: number): Window {
  const mm = String(month).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDayOf(year, month)).padStart(2, '0')}`,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
    explicit: true,
  };
}

function yearWindow(year: number): Window {
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year), explicit: true };
}

function shiftMonth(key: string, offset: number): { year: number; month: number } {
  const year = Number(key.slice(0, 4));
  const raw = Number(key.slice(5, 7)) + offset;
  return {
    year: year + Math.floor((raw - 1) / 12),
    month: ((((raw - 1) % 12) + 12) % 12) + 1,
  };
}

/** Monday of the ISO week `date` falls in. */
function weekStart(date: IsoDate): IsoDate {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day === 0 ? 7 : day) - 1));
}

function quarterWindow(year: number, quarter: number): Window {
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  return {
    from: `${year}-${String(first).padStart(2, '0')}-01`,
    to: `${year}-${String(last).padStart(2, '0')}-${String(lastDayOf(year, last)).padStart(2, '0')}`,
    label: `Q${quarter} ${year}`,
    explicit: true,
  };
}

/**
 * The first match wins, and the rules are ordered most specific first, so
 * "2026-03" beats "this month" in a question that somehow contains both.
 */
export function resolveWindow(question: string, today: IsoDate): Window {
  const text = question.toLowerCase();
  const thisMonth = monthKey(today);
  const thisYear = Number(today.slice(0, 4));
  const currentQuarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;

  // 1. An explicit range: 2026-01-01 to 2026-03-31.
  const range = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|until|through|and|-|–|~|至|到)\s*(\d{4}-\d{2}-\d{2})/,
  );
  if (range?.[1] !== undefined && range[2] !== undefined && range[1] <= range[2]) {
    return { from: range[1], to: range[2], label: `${range[1]} to ${range[2]}`, explicit: true };
  }

  // 2. An explicit month: 2026-03, 2026年3月, March 2026, in March.
  const isoMonth = text.match(/\b(\d{4})-(0[1-9]|1[0-2])\b(?!-\d)/);
  if (isoMonth?.[1] !== undefined && isoMonth[2] !== undefined) {
    return monthWindow(Number(isoMonth[1]), Number(isoMonth[2]));
  }
  const cnMonth = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (cnMonth?.[1] !== undefined && cnMonth[2] !== undefined) {
    return monthWindow(Number(cnMonth[1]), Number(cnMonth[2]));
  }
  const named = text.match(
    new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b(?:\\s+(\\d{4}))?`),
  );
  if (named?.[1] !== undefined) {
    const month = MONTH_NAMES.indexOf(named[1]) + 1;
    const year =
      named[2] !== undefined
        ? Number(named[2])
        : // No year given: the most recent one that has happened.
          month <= Number(today.slice(5, 7))
          ? thisYear
          : thisYear - 1;
    return monthWindow(year, month);
  }

  // 3. Quarters.
  const isoQuarter = text.match(/\b(?:q([1-4])\s*(\d{4})|(\d{4})\s*q([1-4]))\b/);
  if (isoQuarter !== null) {
    const quarter = Number(isoQuarter[1] ?? isoQuarter[4]);
    const year = Number(isoQuarter[2] ?? isoQuarter[3]);
    return quarterWindow(year, quarter);
  }
  if (/last quarter|previous quarter|上(?:个)?季度/.test(text)) {
    const quarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
    return quarterWindow(currentQuarter === 1 ? thisYear - 1 : thisYear, quarter);
  }
  if (/this quarter|本季度|这(?:个)?季度/.test(text)) {
    return quarterWindow(thisYear, currentQuarter);
  }

  // 4. Rolling windows: last 90 days, 最近三个月, past 6 weeks.
  const days = text.match(new RegExp(`(?:last|past|previous|recent)\\s+${COUNT}\\s*days?|(?:过去|最近|近)\\s*${COUNT}\\s*天`));
  if (days !== null) {
    const count = parseCount(days[1] ?? days[2] ?? '');
    if (count !== null && count > 0) {
      return {
        from: addDays(today, -(count - 1)),
        to: today,
        label: `the last ${count} days`,
        explicit: true,
      };
    }
  }

  const weeks = text.match(new RegExp(`(?:last|past|previous|recent)\\s+${COUNT}\\s*weeks?|(?:过去|最近|近)\\s*${COUNT}\\s*(?:周|星期)`));
  if (weeks !== null) {
    const count = parseCount(weeks[1] ?? weeks[2] ?? '');
    if (count !== null && count > 0) {
      return {
        from: addDays(today, -(count * 7 - 1)),
        to: today,
        label: `the last ${count} weeks`,
        explicit: true,
      };
    }
  }

  const months = text.match(new RegExp(`(?:last|past|previous|recent)\\s+${COUNT}\\s*months?|(?:过去|最近|近)\\s*${COUNT}\\s*(?:个)?月`));
  if (months !== null) {
    const count = parseCount(months[1] ?? months[2] ?? '');
    if (count !== null && count > 0) {
      // Whole calendar months ending with the current one, so a monthly
      // series has no half month at either end.
      const start = shiftMonth(thisMonth, -(count - 1));
      return {
        from: `${start.year}-${String(start.month).padStart(2, '0')}-01`,
        to: monthOf(today).to,
        label: `the last ${count} months`,
        explicit: true,
      };
    }
  }

  // 5. Named relative windows.
  if (/last month|previous month|上(?:个)?月/.test(text)) {
    const previous = shiftMonth(thisMonth, -1);
    return monthWindow(previous.year, previous.month);
  }
  if (/this month|current month|本月|这(?:个)?月/.test(text)) {
    const window = monthOf(today);
    return { from: window.from, to: window.to, label: 'this month', explicit: true };
  }
  if (/last week|previous week|上(?:个)?(?:周|星期)/.test(text)) {
    const start = addDays(weekStart(today), -7);
    return { from: start, to: addDays(start, 6), label: 'last week', explicit: true };
  }
  if (/this week|本周|这(?:个)?(?:周|星期)/.test(text)) {
    const start = weekStart(today);
    return { from: start, to: addDays(start, 6), label: 'this week', explicit: true };
  }
  if (/year to date|ytd|so far this year|年初至今|今年以来/.test(text)) {
    return { from: `${thisYear}-01-01`, to: today, label: `${thisYear} so far`, explicit: true };
  }
  if (/last year|previous year|去年|上一年/.test(text)) {
    return yearWindow(thisYear - 1);
  }
  if (/this year|今年|本年/.test(text)) {
    return yearWindow(thisYear);
  }

  // 6. A bare year, once every phrase that contains one has been ruled out.
  const bareYear = text.match(/\b(20\d{2})\s*年?\b/);
  if (bareYear?.[1] !== undefined) return yearWindow(Number(bareYear[1]));

  const fallback = monthOf(today);
  return { from: fallback.from, to: fallback.to, label: 'this month', explicit: false };
}

/** "vs last month" / 同比 / year over year. Absent means no comparison. */
export function resolveComparison(question: string): CompareTo | undefined {
  const text = question.toLowerCase();
  if (
    /year over year|year-over-year|\byoy\b|same (?:month|period) last year|the year before|同比|与去年同期/.test(
      text,
    )
  ) {
    return 'previous_year';
  }
  if (
    /month over month|month-on-month|\bmom\b|环比|vs\.? (?:last|previous|the)|versus (?:last|previous|the)|compared? (?:to|with) (?:last|previous|the)|the (?:month|period) before|对比上|比上(?:个)?月/.test(
      text,
    )
  ) {
    return 'previous_period';
  }
  return undefined;
}
