/**
 * What the question is about.
 *
 * A topic owns the blocks that answer it. Topics are deliberately a closed
 * list built from registry metrics: the planner can only ask for figures that
 * already exist, so "invalid is rejected, never degraded" (FR-ANA-02) is true
 * by construction here, not just at the validator.
 *
 * Matching is keyword scoring, in both languages. It is not clever, and it is
 * not meant to be — the model planner is the clever one, and this is what
 * runs when there is no model, when the model fails, and in every test.
 */

import type { NarrativeFocus, SpecBlock } from '@kiwi/report-spec';

export type TopicId =
  | 'subscriptions'
  | 'fx'
  | 'budget'
  | 'anomalies'
  | 'tax'
  | 'merchants'
  | 'categories'
  | 'trend'
  | 'cashflow'
  | 'data_quality'
  | 'spend'
  | 'overview';

export interface TopicBlockOptions {
  /** From "top 5 merchants"; absent means the block's own default. */
  readonly limit?: number;
}

export interface Topic {
  readonly id: TopicId;
  /** Names the report when this topic leads. */
  readonly title: string;
  /** A hit is worth 1. */
  readonly match: RegExp;
  /** A hit is worth 2 — the phrase means this topic and little else. */
  readonly strong?: RegExp;
  readonly focus: readonly NarrativeFocus[];
  /**
   * A catch-all topic: its words appear in questions that are really about
   * something else, so its score is halved and it can never pull a second
   * topic into a report.
   */
  readonly generic?: boolean;
  blocks(options: TopicBlockOptions): SpecBlock[];
}

export const TOPICS: readonly Topic[] = [
  {
    id: 'subscriptions',
    title: 'Subscriptions and recurring charges',
    strong: /subscription|recurring|auto[- ]?renew|订阅|会员费|自动续费|包月/,
    match: /renew|membership|monthly charge|定期|扣款|续订/,
    focus: ['subscriptions', 'summary'],
    blocks: ({ limit }) => [
      { type: 'metric_row', title: 'Recurring', metrics: ['subscription_total', 'expense_total'] },
      { type: 'table', title: 'What repeats', metric: 'recurring_detected', limit: limit ?? 12 },
      { type: 'table', title: 'Price rises', metric: 'price_increase_alert' },
    ],
  },
  {
    id: 'fx',
    title: 'Currency exposure',
    strong: /\bfx\b|exchange rate|foreign currenc|cross[- ]border|汇率|外币|换汇|多币种|跨境/,
    match: /currenc|overseas|abroad|travel|出国|国外|境外|旅行/,
    focus: ['fx_exposure', 'summary'],
    blocks: () => [
      { type: 'metric_row', title: 'Exposure', metrics: ['fx_exposure', 'expense_total'] },
      { type: 'chart', title: 'By currency', viz: 'bar', metric: 'spend_by_currency' },
    ],
  },
  {
    id: 'budget',
    title: 'Budget',
    strong: /budget|over ?spend|overspent|allowance|预算|超支|还能花/,
    match: /on track|left to spend|限额|额度|剩多少/,
    focus: ['budget', 'summary'],
    blocks: () => [
      { type: 'metric_row', title: 'Against plan', metrics: ['daily_allowance', 'expense_total'] },
      { type: 'chart', title: 'Budget variance', viz: 'bar', metric: 'budget_variance' },
    ],
  },
  {
    id: 'anomalies',
    title: 'Unusual spending',
    strong: /anomal|unusual|out of the ordinary|异常|反常|可疑|离谱/,
    match: /strange|odd|surpris|weird|big(?:gest)? (?:purchase|charge|expense|spend)|largest|大额|最大的?(?:一)?笔/,
    focus: ['anomalies', 'summary'],
    blocks: ({ limit }) => [
      { type: 'metric_row', title: 'Against your usual', metrics: ['rolling_avg', 'expense_total'] },
      { type: 'table', title: 'Stood out', metric: 'large_anomalies', limit: limit ?? 20 },
    ],
  },
  {
    id: 'tax',
    title: 'Claimable spending',
    strong: /\btax\b|deduct|claimable|reimburs|报销|抵扣|纳税|税务/,
    match: /expense report|receipts for work|发票|工作支出/,
    focus: ['summary', 'data_quality'],
    blocks: ({ limit }) => [
      { type: 'metric_row', title: 'Claimable', metrics: ['deductible_total', 'expense_total'] },
      { type: 'table', title: 'By exact category', metric: 'category_export', limit: limit ?? 100 },
    ],
  },
  {
    id: 'merchants',
    title: 'Where the money went',
    strong: /merchant|vendor|商家|商户|花在哪|哪家店/,
    match: /shop|store|which places|who did i pay|店铺|消费地点/,
    focus: ['summary'],
    blocks: ({ limit }) => [
      { type: 'metric_row', title: 'Total', metrics: ['expense_total'] },
      { type: 'table', title: 'Top merchants', metric: 'top_merchants', limit: limit ?? 10 },
    ],
  },
  {
    id: 'categories',
    title: 'Spending by category',
    // "uncategorised" is a data-quality question, not a breakdown request.
    strong: /(?<!un)categor|breakdown|break it down|分类|类别|构成|占比/,
    match: /what did i spend it on|what am i spending on|花在什么|都花在/,
    focus: ['summary', 'trends'],
    blocks: () => [
      { type: 'metric_row', title: 'Total', metrics: ['expense_total', 'income_total'] },
      { type: 'chart', title: 'By category', viz: 'bar', metric: 'category_share' },
    ],
  },
  {
    id: 'trend',
    title: 'Spending over time',
    strong: /trend|over time|month by month|by month|趋势|走势|逐月|每个?月的?变化/,
    match: /monthly|history|rising|falling|going up|going down|增长|下降|变化/,
    focus: ['trends', 'summary'],
    blocks: () => [
      { type: 'metric_row', title: 'Change', metrics: ['expense_total', 'mom_delta'] },
      { type: 'chart', title: 'By month', viz: 'line', metric: 'spend_by_month' },
    ],
  },
  {
    id: 'cashflow',
    title: 'Income and savings',
    strong: /savings? rate|net cash|cash flow|储蓄率|净现金|结余|存下/,
    match: /income|salary|earn|saved?|surplus|收入|工资|存钱|盈余/,
    focus: ['summary', 'trends'],
    blocks: () => [
      {
        type: 'metric_row',
        title: 'Flow',
        metrics: ['income_total', 'expense_total', 'net_cash_flow', 'savings_rate'],
      },
    ],
  },
  {
    id: 'data_quality',
    title: 'Uncategorised spending',
    strong: /uncategor|un-?labell?ed|未分类|没分类|没有分类/,
    match: /missing categor|tidy up|clean up|数据质量|整理/,
    focus: ['data_quality'],
    blocks: () => [
      { type: 'metric_row', title: 'Coverage', metrics: ['uncategorized_ratio', 'expense_total'] },
      { type: 'chart', title: 'By category', viz: 'bar', metric: 'category_share' },
    ],
  },
  {
    id: 'spend',
    title: 'Spending',
    generic: true,
    strong: /how much did i spend|how much have i spent|total spend|花了多少|消费了多少|总支出/,
    match: /spend|spent|spending|cost|how much|支出|消费|花费|多少钱/,
    focus: ['summary'],
    blocks: () => [
      { type: 'metric_row', title: 'Total', metrics: ['expense_total', 'income_total'] },
      { type: 'chart', title: 'By category', viz: 'bar', metric: 'category_share' },
    ],
  },
];

/** What a question with no recognisable topic gets. */
export const OVERVIEW: Topic = {
  id: 'overview',
  title: 'Overview',
  match: /$^/,
  focus: ['summary', 'trends'],
  blocks: ({ limit }) => [
    {
      type: 'metric_row',
      title: 'Headline',
      metrics: ['expense_total', 'income_total', 'savings_rate'],
    },
    { type: 'chart', title: 'By category', viz: 'bar', metric: 'category_share' },
    { type: 'table', title: 'Top merchants', metric: 'top_merchants', limit: limit ?? 8 },
  ],
};

export interface ScoredTopic {
  readonly topic: Topic;
  readonly score: number;
}

/** Highest first; topics that did not match at all are left out. */
export function scoreTopics(question: string): ScoredTopic[] {
  const text = question.toLowerCase();
  return TOPICS.map((topic) => {
    const raw = (topic.strong?.test(text) === true ? 2 : 0) + (topic.match.test(text) ? 1 : 0);
    return { topic, score: topic.generic === true ? raw / 2 : raw };
  })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score);
}
