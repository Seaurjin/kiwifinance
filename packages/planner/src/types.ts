/**
 * What a planner takes and what it gives back.
 *
 * The planner's output is a *Report Spec*, never a figure and never a
 * sentence about a figure. That is PRD P-1 at the entry point: a question in
 * plain language is turned into a query, the query is executed by the metric
 * engine, and only then does a number exist. A planner that cannot express a
 * question says so in `notes` rather than inventing a metric for it.
 */

import type { CurrencyCode, IsoDate } from '@kiwi/core';
import type { ReportSpec } from '@kiwi/report-spec';

export interface PlanCategory {
  readonly id: string;
  readonly name: string;
  readonly slug?: string;
}

export interface PlanContext {
  /** Injected, never read from the clock, so a plan is reproducible. */
  readonly today: IsoDate;
  readonly baseCurrency: CurrencyCode;
  /** Lets "how much on groceries" resolve to a real category id. */
  readonly categories?: readonly PlanCategory[];
  /** Currencies the ledger actually holds, for a sanity check on filters. */
  readonly currencies?: readonly CurrencyCode[];
}

/**
 * Everything the planner decided that the user did not say, and everything
 * they said that the planner could not use. Shown to the user, because a plan
 * they cannot inspect is a plan they cannot correct (FR-ANA-07).
 */
export interface PlanNote {
  readonly kind: 'assumption' | 'ignored' | 'filter' | 'fallback';
  readonly message: string;
}

export type PlanSource = 'template' | 'model';

export interface PlanResult {
  /** Always valid: it has been through `parseSpec`. */
  readonly spec: ReportSpec;
  readonly source: PlanSource;
  /** Which template matched, when the template planner produced it. */
  readonly template?: string;
  /** 0–1. Low means "this is a guess at what you meant", not "the figures are soft". */
  readonly confidence: number;
  readonly notes: readonly PlanNote[];
  /** The question as asked, kept so a saved report can show its origin. */
  readonly question: string;
}

export interface Planner {
  plan(question: string, context: PlanContext): Promise<PlanResult>;
}

export class QuestionEmptyError extends Error {
  constructor() {
    super('A report needs a question. Ask for something — "what did I spend last month?"');
    this.name = 'QuestionEmptyError';
  }
}
