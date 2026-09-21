/**
 * Turning facts into text.
 *
 * Shared by the web and iOS apps so a figure reads identically on both. It
 * formats what the engine produced and never derives a new number — the unit
 * and currency come off the fact, they are not guessed from the value.
 */

import { minorUnitExponent, minorUnitsPerMajor } from '@kiwi/core';
import type { Fact, ScalarFact, SeriesFact } from '@kiwi/metrics';

export interface FormatOptions {
  readonly locale?: string;
  /** Drop the fractional part when the figure is large enough not to need it. */
  readonly compact?: boolean;
}

export function formatMoneyMinor(
  amountMinor: number,
  currency: string,
  options: FormatOptions = {},
): string {
  const digits = minorUnitExponent(currency);
  const major = amountMinor / minorUnitsPerMajor(currency);
  const useCompact = options.compact === true && Math.abs(major) >= 1000;

  return new Intl.NumberFormat(options.locale ?? 'en-SG', {
    style: 'currency',
    currency,
    // The ISO code rather than a symbol. In a ledger that holds SGD, USD and
    // CNY at once, "$474.56" beside "CN¥68.00" invites exactly the confusion
    // this product exists to remove.
    currencyDisplay: 'code',
    minimumFractionDigits: useCompact ? 0 : digits,
    maximumFractionDigits: useCompact ? 0 : digits,
  }).format(major);
}

export function formatRatio(value: number, options: FormatOptions = {}): string {
  return new Intl.NumberFormat(options.locale ?? 'en-SG', {
    style: 'percent',
    maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0,
  }).format(value);
}

/** The display string for a fact's value, or its reason for being absent. */
export function formatFactValue(
  fact: ScalarFact,
  options: FormatOptions = {},
): { text: string; available: boolean } {
  if (fact.value === null) {
    return { text: fact.unavailableReason ?? 'Not available', available: false };
  }
  switch (fact.unit) {
    case 'money':
      return {
        text: formatMoneyMinor(fact.value, fact.currency ?? 'USD', options),
        available: true,
      };
    case 'ratio':
      return { text: formatRatio(fact.value, options), available: true };
    case 'days':
      return { text: `${Math.round(fact.value)} days`, available: true };
    case 'count':
      return { text: String(Math.round(fact.value)), available: true };
  }
}

export function formatSeriesValue(
  fact: SeriesFact,
  value: number | null,
  options: FormatOptions = {},
): string {
  if (value === null) return '—';
  if (fact.unit === 'money') return formatMoneyMinor(value, fact.currency ?? 'USD', options);
  if (fact.unit === 'ratio') return formatRatio(value, options);
  return String(Math.round(value));
}

export const isScalar = (fact: Fact): fact is ScalarFact => fact.kind === 'scalar';
export const isSeries = (fact: Fact): fact is SeriesFact => fact.kind === 'series';

/**
 * Direction of a change, for the arrow beside a comparison. Spending more is
 * "up", which is not the same as "good" — the caller decides what colour that
 * deserves, because for spending up is bad and for income up is good.
 */
export function compareFacts(
  current: ScalarFact,
  previous: ScalarFact | undefined,
): { delta: number; ratio: number | null; direction: 'up' | 'down' | 'flat' } | null {
  if (previous === undefined || current.value === null || previous.value === null) return null;
  const delta = current.value - previous.value;
  return {
    delta,
    ratio: previous.value === 0 ? null : delta / Math.abs(previous.value),
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/** A short, locale-independent label for a period. */
export function formatPeriod(from: string, to: string, locale = 'en-SG'): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const monthYear = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (sameMonth) return monthYear.format(start);
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${short.format(start)} – ${short.format(end)}`;
}
