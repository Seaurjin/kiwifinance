/**
 * The narrator number guard.
 *
 * FR-ANA-06 says the narrating model may only use numbers that are already in
 * the fact set. A prompt asking nicely is not an enforcement mechanism, so
 * this is the check that runs on the model's output before a user ever sees it:
 * every number in the text must round to a figure the engine actually
 * computed, otherwise the narrative is rejected and regenerated.
 *
 * What counts as a match is deliberately generous about *form* and strict
 * about *value*. "1,234.50", "$1234.5" and "1234.5" all match the same
 * computed figure; 1,234.60 matches nothing and fails.
 */

import { minorUnitsPerMajor } from '@kiwi/core';
import type { Fact } from '@kiwi/metrics';
import type { FactSet } from './types.ts';

export interface NarrativeViolation {
  /** The number as written in the text. */
  readonly token: string;
  /** Character offset in the narrative. */
  readonly index: number;
  readonly message: string;
}

export class NarrativeNotGroundedError extends Error {
  constructor(readonly violations: readonly NarrativeViolation[]) {
    super(
      `Narrative cites ${violations.length} number(s) that are not in the fact set:\n` +
        violations.map((v) => `  "${v.token}" at ${v.index}: ${v.message}`).join('\n'),
    );
    this.name = 'NarrativeNotGroundedError';
  }
}

export interface GuardOptions {
  /**
   * Allow bare integers 0–31 that are not in the fact set. Off by default:
   * they are how "$25" slips through as "25". Turn on only if a narrative
   * genuinely needs to count things the engine did not count.
   */
  readonly allowSmallIntegers?: boolean;
  /** Extra values the caller vouches for (a budget name containing a year, say). */
  readonly extraAllowed?: readonly number[];
}

/** Numbers the narrator is allowed to write, derived from the fact set alone. */
export function allowedValues(factSet: FactSet): number[] {
  const values: number[] = [];

  const pushMoney = (minor: number, currency: string | undefined): void => {
    values.push(minor);
    if (currency !== undefined) values.push(minor / minorUnitsPerMajor(currency));
  };

  const collect = (fact: Fact): void => {
    if (fact.kind === 'scalar') {
      if (fact.value === null) return;
      if (fact.unit === 'money') pushMoney(fact.value, fact.currency);
      else if (fact.unit === 'ratio') values.push(fact.value, fact.value * 100);
      else values.push(fact.value);
      return;
    }

    values.push(fact.rows.length);
    for (const row of fact.rows) {
      if (row.value !== null) {
        if (fact.unit === 'money') pushMoney(row.value, fact.currency);
        else if (fact.unit === 'ratio') values.push(row.value, row.value * 100);
        else values.push(row.value);
      }
      if (row.share !== undefined) values.push(row.share, row.share * 100);
    }
  };

  for (const block of factSet.blocks) {
    block.facts.forEach(collect);
    block.comparisonFacts?.forEach(collect);
  }

  // Dates of the reporting period are legitimately quotable.
  for (const date of [factSet.basis.period.from, factSet.basis.period.to]) {
    values.push(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
  }
  if (factSet.comparisonPeriod !== undefined) {
    for (const date of [factSet.comparisonPeriod.from, factSet.comparisonPeriod.to]) {
      values.push(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
    }
  }

  // Both signs, since a narrative says "spent 240" for a −240 flow.
  return [...new Set(values.flatMap((value) => [value, -value]))];
}

/** Numbers, with optional thousands separators and an optional trailing percent. */
const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
/** ISO dates are masked before scanning so their parts are not read as figures. */
const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;

function decimalsIn(token: string): number {
  const dot = token.indexOf('.');
  return dot === -1 ? 0 : token.length - dot - 1;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function findUncitedNumbers(
  narrative: string,
  factSet: FactSet,
  options: GuardOptions = {},
): NarrativeViolation[] {
  const allowed = [...allowedValues(factSet), ...(options.extraAllowed ?? [])];
  // Keep offsets stable by replacing each date character-for-character.
  const scanned = narrative.replace(ISO_DATE_PATTERN, (match) => '\u0000'.repeat(match.length));

  const violations: NarrativeViolation[] = [];

  for (const match of scanned.matchAll(NUMBER_PATTERN)) {
    const token = match[0];
    const index = match.index;
    const isPercent = scanned[index + token.length] === '%';
    const written = Number(token.replace(/,/g, ''));
    if (!Number.isFinite(written)) continue;

    if (options.allowSmallIntegers === true && Number.isInteger(written) && Math.abs(written) <= 31) {
      continue;
    }

    const decimals = decimalsIn(token);
    const grounded = allowed.some((value) => roundTo(value, decimals) === written);
    if (grounded) continue;

    violations.push({
      token: isPercent ? `${token}%` : token,
      index,
      message: isPercent
        ? `No computed share rounds to ${written}% at this precision.`
        : `No computed figure rounds to ${written} at this precision.`,
    });
  }

  return violations;
}

/** Throws when the narrative contains a number the engine did not produce. */
export function assertNarrativeCitesOnlyFacts(
  narrative: string,
  factSet: FactSet,
  options: GuardOptions = {},
): void {
  const violations = findUncitedNumbers(narrative, factSet, options);
  if (violations.length > 0) throw new NarrativeNotGroundedError(violations);
}
