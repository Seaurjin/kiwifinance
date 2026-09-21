/**
 * The planner.
 *
 * Two things are being checked here, and the second matters more than the
 * first. One: a question lands on the right figures. Two: whatever the
 * planner produces is a *valid spec* — so a report that reaches a user has
 * been through the same gate as a spec written by hand, and a plan that
 * cannot be expressed is refused rather than approximated.
 */

import { DEMO_TODAY, demoSnapshot } from '@kiwi/ledger';
import type { ScalarFact } from '@kiwi/metrics';
import {
  QuestionEmptyError,
  RouterPlanner,
  TemplatePlanner,
  planWithTemplates,
  type PlanContext,
} from '@kiwi/planner';
import {
  DEFAULT_ROUTING,
  ModelRouter,
  type AdapterResponse,
  type ProviderAdapter,
  type ProviderId,
} from '@kiwi/model-router';
import { executeSpec, validateSpec, type MetricRowBlock, type TableBlock } from '@kiwi/report-spec';
import { describe, expect, it } from 'vitest';

const context: PlanContext = {
  today: '2026-09-21',
  baseCurrency: 'SGD',
  categories: [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-coffee', name: 'Coffee' },
  ],
};

const plan = (question: string) => planWithTemplates(question, context);
const metricsOf = (block: unknown) => (block as MetricRowBlock).metrics;

describe('what the question is about', () => {
  it('routes a subscription question to the recurring metrics', () => {
    const result = plan('show me my subscriptions');
    expect(result.template).toBe('subscriptions');
    expect(metricsOf(result.spec.blocks[0])).toContain('subscription_total');
    expect(result.spec.blocks.map((b) => (b as TableBlock).metric)).toContain('price_increase_alert');
  });

  it.each([
    ['how much of my spending is in foreign currency this year', 'fx'],
    ['am I over budget?', 'budget'],
    ['anything unusual in the last 90 days', 'anomalies'],
    ['what can I claim on tax for 2025', 'tax'],
    ['top 5 merchants in March', 'merchants'],
    ['break down my spending by category', 'categories'],
    ['is my spending trending up month by month', 'trend'],
    ['what is my savings rate', 'cashflow'],
    ['how much uncategorised spending is there', 'data_quality'],
  ])('%s → %s', (question, template) => {
    expect(plan(question).template).toBe(template);
  });

  it('reads the same questions in Chinese', () => {
    expect(plan('我的订阅花了多少').template).toBe('subscriptions');
    expect(plan('过去三个月的支出趋势').template).toBe('trend');
    expect(plan('这个月预算还剩多少').template).toBe('budget');
    expect(plan('去年有哪些可以报销的').template).toBe('tax');
  });

  it('falls back to an overview and admits that it did', () => {
    const result = plan('kiwi');
    expect(result.template).toBe('overview');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.notes.map((n) => n.message).join(' ')).toContain('general overview');
  });

  it('folds a second strong topic into one report', () => {
    const result = plan('subscriptions and anything unusual last quarter');
    expect(result.template).toBe('subscriptions');
    const metrics = result.spec.blocks.flatMap((block) =>
      block.type === 'metric_row' ? block.metrics : block.type === 'narrative' ? [] : [block.metric],
    );
    expect(metrics).toContain('recurring_detected');
    expect(metrics).toContain('large_anomalies');
  });

  it('keeps a metric_row inside its cap when topics are merged', () => {
    const result = plan('income, savings rate, subscriptions and unusual spending this year');
    const row = result.spec.blocks.find((block) => block.type === 'metric_row');
    expect(metricsOf(row).length).toBeLessThanOrEqual(4);
  });
});

describe('what the planner decided for you', () => {
  it('reports the period it assumed', () => {
    const result = plan('what did I spend on coffee');
    expect(result.spec.period).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.notes).toContainEqual({
      kind: 'assumption',
      message: 'No period was given, so this covers this month (2026-09-01 to 2026-09-30).',
    });
  });

  it('says nothing about a period that was given', () => {
    const result = plan('what did I spend in March 2026');
    expect(result.notes.filter((n) => n.message.includes('No period'))).toHaveLength(0);
  });

  it('reports every filter it applied, because a filter moves every figure', () => {
    const result = plan('how much did I spend on groceries in JPY last month');
    expect(result.spec.filters).toMatchObject({
      currencies: ['JPY'],
      categoryIds: ['cat-groceries'],
    });
    expect(result.notes.filter((note) => note.kind === 'filter')).toHaveLength(2);
  });

  it('does not read the base currency as a filter', () => {
    // "in SGD" means "in my own money", not "drop every foreign row".
    expect(plan('what did I spend in SGD last month').spec.filters?.currencies).toBeUndefined();
  });

  it('refuses to forecast instead of charting a guess', () => {
    const result = plan('how much will I spend next month?');
    const ignored = result.notes.filter((note) => note.kind === 'ignored');
    expect(ignored[0]?.message).toContain('does not forecast');
  });

  it('carries a comparison only when one was asked for', () => {
    expect(plan('spending this month vs last month').spec.period.compareTo).toBe('previous_period');
    expect(plan('spending this month').spec.period.compareTo).toBeUndefined();
  });

  it('does not filter a tax pack down to the tag its own metric finds', () => {
    // Otherwise "total spending" next to "claimable" would be the same number.
    const result = plan('what can I claim for reimbursement this year');
    expect(result.template).toBe('tax');
    expect(result.spec.filters?.tags).toBeUndefined();
  });

  it('does not narrow a report to a category named after the question itself', () => {
    // A ledger with a "Subscriptions" category used to turn "show me my
    // subscriptions" into a report filtered to that one category — which
    // excluded the streaming charges the question was about.
    const result = planWithTemplates('show me my subscriptions', {
      ...context,
      categories: [
        { id: 'cat-subs', name: 'Subscriptions' },
        { id: 'cat-streaming', name: 'Streaming' },
      ],
    });
    expect(result.template).toBe('subscriptions');
    expect(result.spec.filters?.categoryIds).toBeUndefined();
  });

  it('passes a requested limit to the block that can use it', () => {
    const result = plan('top 3 merchants last month');
    const table = result.spec.blocks.find((block) => block.type === 'table');
    expect((table as TableBlock).limit).toBe(3);
  });

  it('drops income figures from a report that covers part of the ledger', () => {
    // Income is not filed under "Groceries", so leaving income_total in would
    // show a true zero that reads as a wrong number.
    const result = plan('how much did I spend on groceries last month');
    const row = result.spec.blocks.find((block) => block.type === 'metric_row');
    expect(metricsOf(row)).toEqual(['expense_total']);
    expect(result.notes.map((note) => note.message).join(' ')).toContain('Income and savings are left out');
  });

  it('reads "vs the month before" as a comparison', () => {
    expect(plan('groceries last month vs the month before').spec.period.compareTo).toBe(
      'previous_period',
    );
  });

  it('refuses an empty question rather than planning something', () => {
    expect(() => plan('   ')).toThrow(QuestionEmptyError);
  });
});

describe('every plan is a valid spec', () => {
  const questions = [
    'what did I spend last month',
    'subscriptions',
    'fx exposure this year',
    'budget',
    'unusual spending',
    'tax pack 2025',
    'top 20 merchants',
    'category breakdown 本月',
    'trend over the last 12 months',
    'savings rate year to date',
    'uncategorised',
    'kiwi',
    'income, savings rate, subscriptions and unusual spending this year',
  ];

  it.each(questions)('%s', (question) => {
    expect(validateSpec(plan(question).spec)).toEqual([]);
  });

  it('always ends with exactly one narrative block', () => {
    for (const question of questions) {
      const narrative = plan(question).spec.blocks.filter((block) => block.type === 'narrative');
      expect(narrative).toHaveLength(1);
      expect(plan(question).spec.blocks.at(-1)?.type).toBe('narrative');
    }
  });
});

describe('plan then execute', () => {
  it('produces figures that match the golden dataset', () => {
    // The planner chose the metric; the engine computed it. 47,456 SGD minor
    // is the same figure metrics.test.ts asserts by hand.
    const result = planWithTemplates('what did I spend in March 2026', {
      today: DEMO_TODAY,
      baseCurrency: 'SGD',
    });
    const factSet = executeSpec(result.spec, { snapshot: demoSnapshot(), today: DEMO_TODAY });
    const expenseTotal = factSet.blocks[0]?.facts.find(
      (fact) => fact.metric === 'expense_total',
    ) as ScalarFact;

    expect(factSet.basis.period).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(expenseTotal.value).toBe(47_456);
    expect(expenseTotal.sourceTxnIds.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The model planner
// ---------------------------------------------------------------------------

function adapter(id: ProviderId, output: unknown): ProviderAdapter {
  return { id, invoke: async (): Promise<AdapterResponse> => ({ output, costUsd: 0.004 }) };
}

const goodSpec = {
  version: 1,
  title: 'Coffee in March',
  period: { from: '2026-03-01', to: '2026-03-31' },
  blocks: [
    { type: 'metric_row', metrics: ['expense_total'] },
    { type: 'narrative', focus: ['summary'] },
  ],
};

const routerWith = (output: unknown) =>
  new RouterPlanner({
    router: new ModelRouter(DEFAULT_ROUTING, [
      adapter('google', output),
      adapter('openai', output),
      adapter('deepseek', output),
    ]),
  });

describe('RouterPlanner', () => {
  it('uses the model\'s spec when it is valid', async () => {
    const result = await routerWith(goodSpec).plan('coffee in march', context);
    expect(result.source).toBe('model');
    expect(result.spec.title).toBe('Coffee in March');
    expect(result.notes[0]?.message).toMatch(/Planned by \w+\//);
  });

  it('throws the model\'s spec away when it names a metric that does not exist', async () => {
    const invented = {
      ...goodSpec,
      blocks: [{ type: 'metric_row', metrics: ['vibe_index'] }, { type: 'narrative' }],
    };
    const result = await routerWith(invented).plan('how am I doing', context);

    expect(result.source).toBe('template');
    expect(result.notes[0]?.kind).toBe('fallback');
    expect(result.notes[0]?.message).toContain('vibe_index');
    // And what the user gets is a real, runnable report — not an error page.
    expect(validateSpec(result.spec)).toEqual([]);
  });

  it('falls back when every provider fails', async () => {
    const failing = new ModelRouter(DEFAULT_ROUTING, []);
    const planner = new RouterPlanner({ router: failing, fallback: new TemplatePlanner() });
    const result = await planner.plan('subscriptions', context);

    expect(result.source).toBe('template');
    expect(result.template).toBe('subscriptions');
    expect(result.notes[0]?.kind).toBe('fallback');
  });

  it('warns when the model plans a period that has not happened', async () => {
    const future = { ...goodSpec, period: { from: '2027-01-01', to: '2027-01-31' } };
    const result = await routerWith(future).plan('next january', context);
    expect(result.notes.some((note) => note.kind === 'ignored')).toBe(true);
  });
});
