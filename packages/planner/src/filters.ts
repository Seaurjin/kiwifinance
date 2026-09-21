/**
 * Filters, limits, and the things the planner will not do.
 *
 * Two of these matter more than they look. A filter the user did not ask for
 * silently changes every figure in the report, so each one applied is
 * reported back as a note. And a question the engine cannot answer —
 * "what will I spend next month?" — is answered with a plain refusal rather
 * than a plausible-looking chart, because the engine reports recorded
 * transactions and does not forecast (P-1).
 */

import type { CurrencyCode } from '@kiwi/core';
import type { MetricFilters } from '@kiwi/metrics';
import type { Topic } from './topics.ts';
import type { PlanCategory, PlanContext, PlanNote } from './types.ts';

const CURRENCY_WORDS: readonly [RegExp, CurrencyCode][] = [
  [/\byen\b|日元|日币/i, 'JPY'],
  [/\brmb\b|\byuan\b|人民币|元人民币/i, 'CNY'],
  [/\beuros?\b|欧元/i, 'EUR'],
  [/\bpounds?\b|\bsterling\b|英镑/i, 'GBP'],
  [/\bwon\b|韩元/i, 'KRW'],
  [/hong kong dollars?|港币|港元/i, 'HKD'],
  [/singapore dollars?|新币|新加坡元/i, 'SGD'],
  [/\bus dollars?\b|美元|美金/i, 'USD'],
];

const TAG_WORDS: readonly [RegExp, string][] = [
  [/\btravel\b|\btrip\b|出差|旅行|旅游/i, 'travel'],
  [/deductible|claimable|reimburs|报销|抵扣/i, 'deductible'],
];

/** Things no metric can answer. Saying so beats answering something else. */
const OUT_OF_SCOPE: readonly [RegExp, string][] = [
  [
    /forecast|predict|will i|next month|next year|expect to spend|预测|预计|未来|下个月会/i,
    'Kiwi reports what was recorded, and does not forecast. This report covers a period that has already happened.',
  ],
  [
    /average person|other people|compared to (?:others|everyone)|别人|平均水平|同龄人/i,
    'There is no data about anyone else here — only your own ledger.',
  ],
  [
    /should i|advise|recommend|worth it|该不该|建议我|值不值/i,
    'The planner picks figures, not advice. The reading below the figures is written by a model and every number in it is checked against them.',
  ],
];

export interface FilterResult {
  readonly filters?: MetricFilters;
  /** From "top 5"; the blocks decide what to do with it. */
  readonly limit?: number;
  readonly notes: readonly PlanNote[];
}

function matchCategories(
  question: string,
  categories: readonly PlanCategory[],
  topic: Topic | undefined,
): PlanCategory[] {
  const text = question.toLowerCase();
  return categories.filter((category) => {
    // A ledger may well have a category called "Subscriptions". The word that
    // chose the report is not also a request to narrow it to one category —
    // doing both is how "show me my subscriptions" returns an empty report.
    const name = category.name.toLowerCase();
    if (topic?.strong?.test(name) === true || topic?.match.test(name) === true) return false;

    // Short names ("gas") would match inside other words; require a boundary
    // for Latin script and a plain substring for CJK, which has none.
    if (/^[\x20-\x7f]+$/.test(name)) {
      return new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?([^a-z]|$)`).test(text);
    }
    return text.includes(name);
  });
}

export function resolveFilters(
  question: string,
  context: PlanContext,
  /** The topic the question landed on, so its own words are not read as a filter. */
  topic?: Topic,
): FilterResult {
  const notes: PlanNote[] = [];
  const filters: {
    currencies?: CurrencyCode[];
    categoryIds?: string[];
    tags?: string[];
  } = {};

  const codes = new Set<CurrencyCode>();
  for (const code of question.match(/\b[A-Z]{3}\b/g) ?? []) {
    if (context.currencies === undefined || context.currencies.includes(code)) codes.add(code);
  }
  for (const [pattern, code] of CURRENCY_WORDS) {
    if (pattern.test(question)) codes.add(code);
  }
  // Naming the base currency is how people say "in my own money", not a
  // request to drop every foreign row.
  codes.delete(context.baseCurrency);
  if (codes.size > 0) {
    filters.currencies = [...codes].sort();
    notes.push({
      kind: 'filter',
      message: `Only ${filters.currencies.join(', ')} transactions are counted.`,
    });
  }

  const tags = TAG_WORDS.filter(([pattern]) => pattern.test(question)).map(([, tag]) => tag);
  if (tags.length > 0) {
    filters.tags = tags;
    notes.push({
      kind: 'filter',
      message: `Only transactions tagged ${tags.join(' or ')} are counted.`,
    });
  }

  const matched = matchCategories(question, context.categories ?? [], topic);
  if (matched.length > 0) {
    filters.categoryIds = matched.map((category) => category.id);
    notes.push({
      kind: 'filter',
      message: `Only the ${matched.map((c) => c.name).join(', ')} categor${
        matched.length === 1 ? 'y' : 'ies'
      } ${matched.length === 1 ? 'is' : 'are'} counted.`,
    });
  }

  for (const [pattern, message] of OUT_OF_SCOPE) {
    if (pattern.test(question)) notes.push({ kind: 'ignored', message });
  }

  const top = question.match(/\btop\s+(\d{1,3})\b|前\s*(\d{1,3})\s*(?:个|名|家)?/i);
  const limitRaw = top?.[1] ?? top?.[2];
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);

  return {
    ...(Object.keys(filters).length > 0 ? { filters: filters as MetricFilters } : {}),
    ...(limit !== undefined && limit > 0 && limit <= 200 ? { limit } : {}),
    notes,
  };
}
