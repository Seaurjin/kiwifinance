/**
 * Task contracts.
 *
 * Product code asks for a *task* — "extract this receipt" — and never names a
 * model. A contract fixes what the task takes, what shape its answer must
 * have, how long it may take, what it may cost, and whether the model is
 * allowed any tools at all.
 *
 * The tool permission is the load-bearing one. A receipt is untrusted input
 * (NFR-S-01): it can carry text instructing the model to do something. An
 * extractor with no tools and a schema-constrained output has nothing to be
 * instructed *into*, which is a stronger guarantee than any wording in a
 * prompt.
 */

export type TaskName = 'classify' | 'extract' | 'plan' | 'narrate';

/** Which market the request belongs to. Drives compliance, not just cost. */
export type Region = 'global' | 'cn';

export type Tier = 'free' | 'plus' | 'pro';

export interface TaskContract {
  readonly name: TaskName;
  readonly description: string;
  /** JSON Schema the provider's answer must satisfy, or it is rejected. */
  readonly outputSchema: Record<string, unknown>;
  readonly timeoutMs: number;
  /** Hard ceiling per call. A provider quoting above this is not invoked. */
  readonly maxCostUsd: number;
  /** False means the adapter must refuse any tool offer for this task. */
  readonly toolsAllowed: boolean;
  /** True when the input may include images. */
  readonly multimodal: boolean;
}

const transactionDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amountMinor', 'currency', 'date', 'confidence'],
  properties: {
    amountMinor: { type: 'integer' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    merchantName: { type: ['string', 'null'], maxLength: 200 },
    categorySlug: { type: ['string', 'null'], maxLength: 64 },
    note: { type: ['string', 'null'], maxLength: 500 },
    lineItems: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'amountMinor'],
        properties: {
          description: { type: 'string', maxLength: 200 },
          amountMinor: { type: 'integer' },
          categorySlug: { type: ['string', 'null'], maxLength: 64 },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export const TASK_CONTRACTS: Readonly<Record<TaskName, TaskContract>> = {
  classify: {
    name: 'classify',
    description: 'Assign a category to one transaction that no local rule matched.',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['categorySlug', 'confidence'],
      properties: {
        categorySlug: { type: 'string', maxLength: 64 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    timeoutMs: 5_000,
    maxCostUsd: 0.002,
    toolsAllowed: false,
    multimodal: false,
  },

  extract: {
    name: 'extract',
    description: 'Turn a receipt, screenshot or forwarded email into a draft transaction.',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['drafts'],
      properties: {
        drafts: { type: 'array', minItems: 0, maxItems: 50, items: transactionDraftSchema },
      },
    },
    timeoutMs: 20_000,
    maxCostUsd: 0.02,
    // Untrusted input. No tools, ever.
    toolsAllowed: false,
    multimodal: true,
  },

  plan: {
    name: 'plan',
    description: 'Turn a question in plain language into a Report Spec.',
    // Validated again, properly, by @kiwi/report-spec. This is the cheap gate.
    outputSchema: {
      type: 'object',
      required: ['version', 'title', 'period', 'blocks'],
      properties: {
        version: { const: 1 },
        title: { type: 'string' },
        period: { type: 'object' },
        blocks: { type: 'array', minItems: 1 },
      },
    },
    timeoutMs: 30_000,
    maxCostUsd: 0.05,
    toolsAllowed: false,
    multimodal: false,
  },

  narrate: {
    name: 'narrate',
    description: 'Write the reading of an already-computed fact set.',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', maxLength: 4_000 },
        citations: { type: 'array', items: { type: 'string', maxLength: 32 } },
      },
    },
    timeoutMs: 30_000,
    maxCostUsd: 0.05,
    toolsAllowed: false,
    multimodal: false,
  },
};
