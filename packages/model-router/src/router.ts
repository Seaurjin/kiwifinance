/**
 * The router itself.
 *
 * It resolves a task to a model, invokes the adapter, validates the answer
 * against the task's output schema, and falls back when a provider fails.
 * An answer that does not match the schema is a failure, not a partial
 * success — nothing downstream ever sees a half-parsed extraction.
 */

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { TASK_CONTRACTS, type Region, type TaskContract, type TaskName, type Tier } from './contracts.ts';
import {
  assertRoutingCompliance,
  resolveRoute,
  type ProviderId,
  type Route,
  type RoutingTable,
} from './routing.ts';

export interface AdapterRequest {
  readonly model: string;
  readonly contract: TaskContract;
  readonly input: unknown;
  /** Images, for multimodal tasks. Base64 or a storage reference. */
  readonly images?: readonly string[];
  readonly params?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface AdapterResponse {
  readonly output: unknown;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly costUsd?: number;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  invoke(request: AdapterRequest): Promise<AdapterResponse>;
}

export interface TaskResult<T> {
  readonly output: T;
  readonly provider: ProviderId;
  readonly model: string;
  readonly costUsd: number;
  /** Providers that failed before this one answered. */
  readonly attempts: readonly { provider: ProviderId; model: string; error: string }[];
}

export class TaskOutputInvalidError extends Error {
  constructor(
    readonly task: TaskName,
    readonly provider: ProviderId,
    readonly details: string,
  ) {
    super(`${provider} returned an answer for "${task}" that does not match its contract: ${details}`);
    this.name = 'TaskOutputInvalidError';
  }
}

export class NoProviderAvailableError extends Error {
  constructor(
    readonly task: TaskName,
    readonly attempts: readonly { provider: ProviderId; model: string; error: string }[],
  ) {
    super(
      `Every provider for "${task}" failed:\n` +
        attempts.map((a) => `  ${a.provider}/${a.model}: ${a.error}`).join('\n'),
    );
    this.name = 'NoProviderAvailableError';
  }
}

export class CostCeilingExceededError extends Error {
  constructor(task: TaskName, quoted: number, ceiling: number) {
    super(`A ${task} call costing $${quoted} exceeds its $${ceiling} ceiling and was discarded.`);
    this.name = 'CostCeilingExceededError';
  }
}

export interface RunRequest {
  readonly task: TaskName;
  readonly region: Region;
  readonly tier?: Tier;
  readonly input: unknown;
  readonly images?: readonly string[];
  readonly signal?: AbortSignal;
}

export class ModelRouter {
  readonly #table: RoutingTable;
  readonly #adapters: Map<ProviderId, ProviderAdapter>;
  readonly #validators = new Map<TaskName, ValidateFunction>();
  readonly #ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(table: RoutingTable, adapters: readonly ProviderAdapter[]) {
    // A non-compliant table must not be constructible, let alone reachable.
    assertRoutingCompliance(table);
    this.#table = table;
    this.#adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  }

  resolve(region: Region, task: TaskName, tier: Tier = 'plus'): Route {
    return resolveRoute(this.#table, region, task, tier);
  }

  #validatorFor(task: TaskName): ValidateFunction {
    let validator = this.#validators.get(task);
    if (validator === undefined) {
      validator = this.#ajv.compile(TASK_CONTRACTS[task].outputSchema);
      this.#validators.set(task, validator);
    }
    return validator;
  }

  async run<T>(request: RunRequest): Promise<TaskResult<T>> {
    const contract = TASK_CONTRACTS[request.task];
    const route = this.resolve(request.region, request.task, request.tier);
    const candidates = [
      { provider: route.provider, model: route.model },
      ...(route.fallbacks ?? []),
    ];

    const attempts: { provider: ProviderId; model: string; error: string }[] = [];

    for (const candidate of candidates) {
      const adapter = this.#adapters.get(candidate.provider);
      if (adapter === undefined) {
        attempts.push({ ...candidate, error: 'no adapter registered' });
        continue;
      }

      try {
        const response = await adapter.invoke({
          model: candidate.model,
          contract,
          input: request.input,
          ...(request.images !== undefined ? { images: request.images } : {}),
          ...(route.params !== undefined ? { params: route.params } : {}),
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        });

        const cost = response.costUsd ?? 0;
        if (cost > contract.maxCostUsd) {
          throw new CostCeilingExceededError(request.task, cost, contract.maxCostUsd);
        }

        const validate = this.#validatorFor(request.task);
        if (!validate(response.output)) {
          throw new TaskOutputInvalidError(
            request.task,
            candidate.provider,
            this.#ajv.errorsText(validate.errors),
          );
        }

        return {
          output: response.output as T,
          provider: candidate.provider,
          model: candidate.model,
          costUsd: cost,
          attempts,
        };
      } catch (error) {
        attempts.push({ ...candidate, error: error instanceof Error ? error.message : String(error) });
      }
    }

    throw new NoProviderAvailableError(request.task, attempts);
  }
}
