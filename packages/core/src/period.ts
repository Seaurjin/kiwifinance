/**
 * Calendar periods.
 *
 * Dates here are plain calendar dates (YYYY-MM-DD), not instants. A purchase
 * on the 3rd is on the 3rd regardless of where the phone was; introducing a
 * timezone would make the same transaction land in different months for
 * different readers, which breaks reproducibility (FR-ANA-08).
 */

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface Period {
  /** Inclusive. */
  readonly from: IsoDate;
  /** Inclusive. */
  readonly to: IsoDate;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ts = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ts)) return false;
  // Reject overflow like 2026-02-31, which Date.parse would silently roll over.
  return new Date(ts).toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: unknown): asserts value is IsoDate {
  if (!isIsoDate(value)) {
    throw new TypeError(`Invalid calendar date: ${JSON.stringify(value)}. Expected YYYY-MM-DD.`);
  }
}

export function period(from: IsoDate, to: IsoDate): Period {
  assertIsoDate(from);
  assertIsoDate(to);
  if (from > to) {
    throw new RangeError(`Period start ${from} is after its end ${to}.`);
  }
  return Object.freeze({ from, to });
}

function toEpochDay(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;
}

function fromEpochDay(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  assertIsoDate(date);
  return fromEpochDay(toEpochDay(date) + days);
}

/** Inclusive day count: a single-day period is 1, not 0. */
export function dayCount(p: Period): number {
  return toEpochDay(p.to) - toEpochDay(p.from) + 1;
}

export function containsDate(p: Period, date: IsoDate): boolean {
  return date >= p.from && date <= p.to;
}

/** The equally long period immediately before this one. */
export function previousPeriod(p: Period): Period {
  const length = dayCount(p);
  return period(addDays(p.from, -length), addDays(p.from, -1));
}

/** The same calendar span one year earlier. */
export function previousYear(p: Period): Period {
  return period(shiftYear(p.from, -1), shiftYear(p.to, -1));
}

function shiftYear(date: IsoDate, years: number): IsoDate {
  const year = Number(date.slice(0, 4)) + years;
  const monthDay = date.slice(4);
  const candidate = `${String(year).padStart(4, '0')}${monthDay}`;
  // 2028-02-29 shifted back a year is not a date; clamp to the month end.
  return isIsoDate(candidate) ? candidate : `${String(year).padStart(4, '0')}-02-28`;
}

/** The whole calendar month a date falls in. */
export function monthOf(date: IsoDate): Period {
  assertIsoDate(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return period(`${date.slice(0, 7)}-01`, `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`);
}

/** Month key (YYYY-MM) used to group a series by month. */
export function monthKey(date: IsoDate): string {
  assertIsoDate(date);
  return date.slice(0, 7);
}

/** ISO weekday, 1 = Monday .. 7 = Sunday. */
export function weekday(date: IsoDate): number {
  assertIsoDate(date);
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Every month key touched by the period, in order. */
export function monthKeysIn(p: Period): string[] {
  const keys: string[] = [];
  let cursor = `${p.from.slice(0, 7)}-01`;
  while (cursor <= p.to) {
    keys.push(cursor.slice(0, 7));
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    cursor = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  }
  return keys;
}

/** Days of the period that have already elapsed as of `today`, inclusive. */
export function elapsedDays(p: Period, today: IsoDate): number {
  assertIsoDate(today);
  if (today < p.from) return 0;
  if (today > p.to) return dayCount(p);
  return toEpochDay(today) - toEpochDay(p.from) + 1;
}

/** Days of the period still to come, counting `today` as remaining. */
export function remainingDays(p: Period, today: IsoDate): number {
  return dayCount(p) - elapsedDays(p, today) + (containsDate(p, today) ? 1 : 0);
}
