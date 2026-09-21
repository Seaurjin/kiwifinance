/**
 * The model planner.
 *
 * Same contract as the template planner, different producer: a model is asked
 * for a spec and the spec is validated exactly as hard as if a stranger had
 * posted it. If the model answers with something the schema or the registry
 * rejects, the spec is *discarded* — never repaired, never partially
 * honoured — and the deterministic planner answers instead. The user sees
 * which one answered.
 *
 * The plan task carries `toolsAllowed: false` (see @kiwi/model-router). A
 * question typed by the user is safer input than a receipt, but the planner
 * still has nothing to be talked into: its entire output surface is a spec
 * that must name registry metrics.
 */

import { defaultRegistry, type MetricRegistry } from '@kiwi/metrics';
import type { ModelRouter, Region, Tier } from '@kiwi/model-router';
import { REPORT_SPEC_SCHEMA, SpecValidationError, parseSpec } from '@kiwi/report-spec';
import { TemplatePlanner } from './template-planner.ts';
import type { PlanContext, PlanNote, PlanResult, Planner } from './types.ts';
import { QuestionEmptyError } from './types.ts';

export interface PlannerPromptInput {
  readonly question: string;
  readonly today: string;
  readonly baseCurrency: string;
  readonly categories: readonly { id: string; name: string }[];
  readonly metrics: readonly { id: string; label: string; unit: string; returns: string; description: string }[];
  readonly schema: unknown;
  readonly instructions: string;
}

/**
 * The standing instruction. It is a constant rather than a string built at
 * call time so it can be read, reviewed and diffed like any other contract.
 */
export const PLANNER_INSTRUCTIONS = [
  'You turn a question about someone\'s own spending into a Report Spec.',
  '',
  'Rules, in order of importance:',
  '1. Never write a figure. You choose which figures to compute; a deterministic',
  '   engine computes them. A number in your output is a bug.',
  '2. Only name metrics from the catalogue you were given. An id that is not in it',
  '   is rejected and your whole answer is thrown away.',
  '3. `period.from` and `period.to` must be concrete dates, resolved against the',
  '   `today` you were given. Never emit a phrase like "last month".',
  '4. A metric that returns a scalar belongs in a metric_row; a metric that returns',
  '   a series belongs in a chart or a table. Mixing them is rejected.',
  '5. End with one narrative block. Its `focus` tells the writer what to look at;',
  '   it carries no numbers.',
  '6. Answer with the spec as JSON and nothing else.',
].join('\n');

export function buildPlannerInput(
  question: string,
  context: PlanContext,
  registry: MetricRegistry = defaultRegistry,
): PlannerPromptInput {
  return {
    question,
    today: context.today,
    baseCurrency: context.baseCurrency,
    categories: (context.categories ?? []).map(({ id, name }) => ({ id, name })),
    metrics: registry.catalogue(),
    schema: REPORT_SPEC_SCHEMA,
    instructions: PLANNER_INSTRUCTIONS,
  };
}

export interface RouterPlannerOptions {
  readonly router: ModelRouter;
  readonly region?: Region;
  readonly tier?: Tier;
  /** Answers when the model cannot. Defaults to the template planner. */
  readonly fallback?: Planner;
  readonly registry?: MetricRegistry;
}

/**
 * Why the model's answer was thrown away, in one line the user can read and
 * a developer can act on. The validator's own message names every registry
 * metric, which is right for a retry prompt and far too long for a note.
 */
function describeFailure(error: unknown): string {
  if (error instanceof SpecValidationError) {
    const first = error.violations
      .slice(0, 2)
      .map(
        (violation) =>
          `${violation.path || '/'}: ${violation.message.split('. ')[0] ?? violation.message}`,
      )
      .join('; ');
    return first.length > 200 ? `${first.slice(0, 197)}…` : first;
  }
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.name;
  return String(error);
}

export class RouterPlanner implements Planner {
  readonly #options: RouterPlannerOptions;
  readonly #fallback: Planner;

  constructor(options: RouterPlannerOptions) {
    this.#options = options;
    this.#fallback = options.fallback ?? new TemplatePlanner();
  }

  async plan(question: string, context: PlanContext): Promise<PlanResult> {
    const asked = question.trim();
    if (asked === '') throw new QuestionEmptyError();

    try {
      const result = await this.#options.router.run<unknown>({
        task: 'plan',
        region: this.#options.region ?? 'global',
        ...(this.#options.tier !== undefined ? { tier: this.#options.tier } : {}),
        input: buildPlannerInput(asked, context, this.#options.registry),
      });

      // The router checked the answer against the task contract, which is a
      // coarse gate. This is the real one.
      const spec = parseSpec(result.output, this.#options.registry);

      const notes: PlanNote[] = [
        {
          kind: 'assumption',
          message: `Planned by ${result.provider}/${result.model}. The figures are computed here, not there.`,
        },
      ];
      if (spec.period.from > context.today) {
        notes.push({
          kind: 'ignored',
          message: 'The period this plan asks for has not happened yet, so it will be empty.',
        });
      }

      return { spec, source: 'model', confidence: 0.8, notes, question: asked };
    } catch (error) {
      const reason = describeFailure(error);
      const fallback = await this.#fallback.plan(asked, context);
      return {
        ...fallback,
        notes: [
          {
            kind: 'fallback',
            message: `The planning model did not return a usable spec (${reason}), so this was planned from the built-in templates instead.`,
          },
          ...fallback.notes,
        ],
      };
    }
  }
}
