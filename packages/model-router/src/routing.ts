/**
 * The routing table and its compliance guard.
 *
 * Which model serves a task is configuration, so swapping one is an edit here
 * and entering a new market is a new column — never a change to product code.
 *
 * One rule in this file is not a preference. NFR-C-05: a request for a
 * mainland-China user may not be served by an overseas model. That is a legal
 * constraint, so it is enforced in code, at construction time, rather than
 * left to whoever edits the config next.
 */

import type { Region, TaskName, Tier } from './contracts.ts';

export type ProviderId = 'google' | 'openai' | 'bailian' | 'deepseek' | 'zhipu' | 'stub';

/** Providers that may serve mainland-China traffic. */
export const CN_APPROVED_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  'bailian',
  'deepseek',
  'zhipu',
  'stub',
]);

/** Providers that may serve everywhere except mainland China. */
export const GLOBAL_PROVIDERS: ReadonlySet<ProviderId> = new Set(['google', 'openai', 'stub']);

export interface Route {
  readonly provider: ProviderId;
  readonly model: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Tried in order when the primary fails or is rate-limited (NFR-R-03). */
  readonly fallbacks?: readonly { provider: ProviderId; model: string }[];
}

export type RoutingTable = {
  readonly [R in Region]: {
    readonly [T in TaskName]: Route | { readonly [K in Tier]?: Route } & { readonly default: Route };
  };
};

export class RoutingComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingComplianceError';
  }
}

/**
 * The shipped default, mirroring docs/04-model-strategy.md.
 * Model ids are configuration; check them against the provider's current
 * catalogue before a release rather than trusting this file to stay fresh.
 */
export const DEFAULT_ROUTING: RoutingTable = {
  global: {
    classify: { provider: 'google', model: 'gemini-2.5-flash-lite' },
    extract: {
      provider: 'google',
      model: 'gemini-3.7-flash',
      fallbacks: [{ provider: 'openai', model: 'gpt-5.6-terra' }],
    },
    plan: {
      provider: 'google',
      model: 'gemini-3.7-flash',
      fallbacks: [{ provider: 'openai', model: 'gpt-5.6-terra' }],
    },
    narrate: { provider: 'google', model: 'gemini-3.1-pro' },
  },
  cn: {
    classify: { provider: 'bailian', model: 'qwen-turbo' },
    extract: { provider: 'bailian', model: 'qwen-vl-ocr' },
    plan: { provider: 'bailian', model: 'qwen3.7-max' },
    narrate: { provider: 'bailian', model: 'qwen3.7-max' },
  },
};

function routesOf(entry: RoutingTable[Region][TaskName]): Route[] {
  if ('provider' in entry) return [entry as Route];
  const tiered = entry as Record<string, Route | undefined>;
  return Object.values(tiered).filter((route): route is Route => route !== undefined);
}

function allowedFor(region: Region): ReadonlySet<ProviderId> {
  return region === 'cn' ? CN_APPROVED_PROVIDERS : GLOBAL_PROVIDERS;
}

/**
 * Rejects a table that would send a region's traffic to a provider it may not
 * use. Called on every ModelRouter construction, so a bad config fails at
 * startup instead of in production.
 */
export function assertRoutingCompliance(table: RoutingTable): void {
  for (const region of Object.keys(table) as Region[]) {
    const allowed = allowedFor(region);
    for (const task of Object.keys(table[region]) as TaskName[]) {
      for (const route of routesOf(table[region][task])) {
        const candidates = [
          { provider: route.provider, model: route.model },
          ...(route.fallbacks ?? []),
        ];
        for (const candidate of candidates) {
          if (!allowed.has(candidate.provider)) {
            throw new RoutingComplianceError(
              `Route ${region}/${task} names provider "${candidate.provider}", which may not serve ` +
                `${region === 'cn' ? 'mainland-China' : 'overseas'} traffic. ` +
                `Allowed here: ${[...allowed].join(', ')}.`,
            );
          }
        }
      }
    }
  }
}

export function resolveRoute(
  table: RoutingTable,
  region: Region,
  task: TaskName,
  tier: Tier = 'plus',
): Route {
  const entry = table[region][task];
  if ('provider' in entry) return entry as Route;
  const tiered = entry as { default: Route } & Partial<Record<Tier, Route>>;
  return tiered[tier] ?? tiered.default;
}
