/**
 * The deterministic planner.
 *
 * It maps a question onto the topics it recognises and assembles their blocks.
 * No model, no network, no key — which is why it is what the tests run
 * against, what the demo runs on, and what catches the model planner when it
 * fails. Its output goes through `parseSpec` like everything else: if this
 * file ever produced an invalid spec that would be a bug, and it would throw
 * here rather than reach a report.
 */

import type { MetricFilters } from '@kiwi/metrics';
import { parseSpec, type NarrativeFocus, type ReportSpec, type SpecBlock } from '@kiwi/report-spec';
import { resolveFilters } from './filters.ts';
import { OVERVIEW, scoreTopics, type Topic } from './topics.ts';
import { QuestionEmptyError, type PlanContext, type PlanNote, type PlanResult, type Planner } from './types.ts';
import { resolveComparison, resolveWindow } from './window.ts';

const MAX_BLOCKS = 6;

/**
 * Figures that stop meaning anything once the report is narrowed to part of
 * the ledger. Income is not filed under "Groceries", so a groceries-only
 * report would show income as zero — a true number and a misleading one.
 */
const WHOLE_LEDGER_ONLY = new Set(['income_total', 'savings_rate', 'net_cash_flow']);
const MAX_ROW_METRICS = 4;
const MAX_FOCUS = 3;

/** A stable key for "the same block twice". */
function blockKey(block: SpecBlock): string {
  if (block.type === 'metric_row') return 'metric_row';
  if (block.type === 'narrative') return 'narrative';
  return `${block.type}:${block.metric}`;
}

function mergeBlocks(primary: SpecBlock[], extra: SpecBlock[]): SpecBlock[] {
  const out: SpecBlock[] = [];
  const seen = new Set<string>();

  for (const block of [...primary, ...extra]) {
    const key = blockKey(block);
    if (block.type === 'metric_row') {
      const existing = out.find((candidate) => candidate.type === 'metric_row');
      if (existing !== undefined && existing.type === 'metric_row') {
        const metrics = [...new Set([...existing.metrics, ...block.metrics])].slice(0, MAX_ROW_METRICS);
        out[out.indexOf(existing)] = { ...existing, metrics };
        continue;
      }
    }
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_BLOCKS) continue;
    out.push(block);
  }

  return out;
}

export interface TemplatePlanOptions {
  /** Topics beyond the leading one to fold in. Only strong matches qualify. */
  readonly maxSecondaryTopics?: number;
}

export function planWithTemplates(
  question: string,
  context: PlanContext,
  options: TemplatePlanOptions = {},
): PlanResult {
  const asked = question.trim();
  if (asked === '') throw new QuestionEmptyError();

  const window = resolveWindow(asked, context.today);
  const compareTo = resolveComparison(asked);
  const scored = scoreTopics(asked);
  const leading = scored[0];
  const primary: Topic = leading?.topic ?? OVERVIEW;

  const filterResult = resolveFilters(asked, context, primary);
  const notes: PlanNote[] = [...filterResult.notes];
  const secondaries = scored
    .slice(1)
    .filter((candidate) => candidate.score >= 2)
    .slice(0, options.maxSecondaryTopics ?? 2)
    .map((candidate) => candidate.topic);

  const blockOptions = filterResult.limit === undefined ? {} : { limit: filterResult.limit };
  const blocks = mergeBlocks(
    primary.blocks(blockOptions),
    secondaries.flatMap((topic) => topic.blocks(blockOptions)),
  );

  const narrowed =
    filterResult.filters?.categoryIds !== undefined || filterResult.filters?.tags !== undefined;
  if (narrowed) {
    let dropped = false;
    for (const [index, block] of blocks.entries()) {
      if (block.type !== 'metric_row') continue;
      const kept = block.metrics.filter((metric) => !WHOLE_LEDGER_ONLY.has(metric));
      if (kept.length === block.metrics.length) continue;
      dropped = true;
      blocks[index] = { ...block, metrics: kept.length > 0 ? kept : ['expense_total'] };
    }
    if (dropped) {
      notes.push({
        kind: 'assumption',
        message:
          'Income and savings are left out: this report covers part of the ledger, and income is not part of it.',
      });
    }
  }

  const focus = [...new Set<NarrativeFocus>([
    ...primary.focus,
    ...secondaries.flatMap((topic) => topic.focus),
  ])].slice(0, MAX_FOCUS);
  blocks.push({ type: 'narrative', focus });

  // The claimable figure picks out its own rows by tag. Filtering the whole
  // report by that tag as well would make "total spending" mean "total
  // claimable spending", which is the opposite of the comparison a tax pack
  // is for.
  let filters: MetricFilters | undefined = filterResult.filters;
  if (primary.id === 'tax' && filters?.tags?.includes('deductible') === true) {
    const { tags, ...rest } = filters;
    const kept = tags.filter((tag) => tag !== 'deductible');
    const next: MetricFilters = kept.length > 0 ? { ...rest, tags: kept } : rest;
    filters = Object.keys(next).length > 0 ? next : undefined;
    notes.push({
      kind: 'assumption',
      message:
        'The claimable total finds its own rows by tag, so the report still shows the whole period next to it.',
    });
  }

  if (!window.explicit) {
    notes.push({
      kind: 'assumption',
      message: `No period was given, so this covers this month (${window.from} to ${window.to}).`,
    });
  }
  if (compareTo !== undefined) {
    notes.push({
      kind: 'assumption',
      message:
        compareTo === 'previous_year'
          ? 'Compared against the same span one year earlier.'
          : 'Compared against the equally long period immediately before.',
    });
  }
  if (primary.id === 'overview') {
    notes.push({
      kind: 'assumption',
      message: 'Nothing in the question named a particular figure, so this is the general overview.',
    });
  }

  const spec: ReportSpec = parseSpec({
    version: 1,
    title: `${primary.title} · ${window.label}`.slice(0, 120),
    period: {
      from: window.from,
      to: window.to,
      ...(compareTo !== undefined ? { compareTo } : {}),
    },
    baseCurrency: context.baseCurrency,
    ...(filters !== undefined ? { filters } : {}),
    blocks,
  });

  const topicConfidence =
    primary.id === 'overview'
      ? 0.35
      : primary.id === 'spend'
        ? 0.6
        : (leading?.score ?? 0) >= 2
          ? 0.85
          : 0.7;
  const confidence = Math.min(0.95, topicConfidence + (window.explicit ? 0.1 : 0));

  return {
    spec,
    source: 'template',
    template: primary.id,
    confidence: Math.round(confidence * 100) / 100,
    notes,
    question: asked,
  };
}

/** The Planner interface over the template planner, for uniform wiring. */
export class TemplatePlanner implements Planner {
  constructor(private readonly options: TemplatePlanOptions = {}) {}

  async plan(question: string, context: PlanContext): Promise<PlanResult> {
    return planWithTemplates(question, context, this.options);
  }
}
