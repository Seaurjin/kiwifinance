import {
  DEFAULT_ROUTING,
  ModelRouter,
  NoProviderAvailableError,
  RoutingComplianceError,
  TASK_CONTRACTS,
  assertRoutingCompliance,
  type AdapterRequest,
  type AdapterResponse,
  type ProviderAdapter,
  type ProviderId,
  type RoutingTable,
} from '@kiwi/model-router';
import { describe, expect, it } from 'vitest';

function stubAdapter(
  id: ProviderId,
  handler: (request: AdapterRequest) => AdapterResponse | Promise<AdapterResponse>,
): ProviderAdapter {
  return { id, invoke: async (request) => handler(request) };
}

const okExtraction: AdapterResponse = {
  output: {
    drafts: [
      { amountMinor: -4_500, currency: 'SGD', date: '2026-03-02', merchantName: 'FairPrice', confidence: 0.96 },
    ],
  },
  costUsd: 0.003,
};

describe('routing compliance', () => {
  it('accepts the shipped default table', () => {
    expect(() => assertRoutingCompliance(DEFAULT_ROUTING)).not.toThrow();
  });

  it('refuses to send mainland-China traffic to an overseas model', () => {
    const table = {
      ...DEFAULT_ROUTING,
      cn: { ...DEFAULT_ROUTING.cn, extract: { provider: 'google', model: 'gemini-3.7-flash' } },
    } as RoutingTable;

    expect(() => assertRoutingCompliance(table)).toThrow(RoutingComplianceError);
    expect(() => assertRoutingCompliance(table)).toThrow(/may not serve mainland-China traffic/);
  });

  it('catches an overseas provider hidden in a fallback list', () => {
    const table = {
      ...DEFAULT_ROUTING,
      cn: {
        ...DEFAULT_ROUTING.cn,
        plan: {
          provider: 'bailian',
          model: 'qwen3.7-max',
          fallbacks: [{ provider: 'openai', model: 'gpt-5.6-terra' }],
        },
      },
    } as RoutingTable;

    expect(() => assertRoutingCompliance(table)).toThrow(RoutingComplianceError);
  });

  it('is enforced at construction, so a bad table is never reachable', () => {
    const table = {
      ...DEFAULT_ROUTING,
      cn: { ...DEFAULT_ROUTING.cn, narrate: { provider: 'openai', model: 'gpt-5.6-terra' } },
    } as RoutingTable;

    expect(() => new ModelRouter(table, [])).toThrow(RoutingComplianceError);
  });
});

describe('task contracts', () => {
  it('forbids tools on extraction, because a receipt is untrusted input', () => {
    expect(TASK_CONTRACTS.extract.toolsAllowed).toBe(false);
  });

  it('forbids tools on every task in the v0 surface', () => {
    for (const contract of Object.values(TASK_CONTRACTS)) {
      expect(contract.toolsAllowed).toBe(false);
    }
  });

  it('marks extraction as the only multimodal task', () => {
    const multimodal = Object.values(TASK_CONTRACTS).filter((c) => c.multimodal);
    expect(multimodal.map((c) => c.name)).toEqual(['extract']);
  });
});

describe('resolution', () => {
  const router = new ModelRouter(DEFAULT_ROUTING, []);

  it('sends the same task to different models per region', () => {
    expect(router.resolve('global', 'extract').model).toBe('gemini-3.7-flash');
    expect(router.resolve('cn', 'extract').model).toBe('qwen-vl-ocr');
  });
});

describe('run', () => {
  it('passes the contract to the adapter and returns its validated output', async () => {
    let seen: AdapterRequest | undefined;
    const router = new ModelRouter(DEFAULT_ROUTING, [
      stubAdapter('google', (request) => {
        seen = request;
        return okExtraction;
      }),
    ]);

    const result = await router.run({ task: 'extract', region: 'global', input: { image: 'x' } });

    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-3.7-flash');
    expect(seen?.contract.toolsAllowed).toBe(false);
    expect((result.output as { drafts: unknown[] }).drafts).toHaveLength(1);
  });

  it('rejects an answer that does not match the contract rather than passing it on', async () => {
    const router = new ModelRouter(DEFAULT_ROUTING, [
      // Amount as a decimal string is exactly the shape that would put a
      // floating-point amount into the ledger.
      stubAdapter('google', () => ({ output: { drafts: [{ amountMinor: '45.00', currency: 'SGD', date: '2026-03-02', confidence: 0.9 }] } })),
      stubAdapter('openai', () => okExtraction),
    ]);

    const result = await router.run({ task: 'extract', region: 'global', input: {} });

    expect(result.provider).toBe('openai');
    expect(result.attempts[0]?.error).toMatch(/does not match its contract/);
  });

  it('discards an answer that cost more than the task ceiling', async () => {
    const router = new ModelRouter(DEFAULT_ROUTING, [
      stubAdapter('google', () => ({ ...okExtraction, costUsd: 5 })),
    ]);

    await expect(router.run({ task: 'extract', region: 'global', input: {} })).rejects.toThrow(
      NoProviderAvailableError,
    );
  });

  it('falls back when the primary provider throws', async () => {
    const router = new ModelRouter(DEFAULT_ROUTING, [
      stubAdapter('google', () => {
        throw new Error('503 from upstream');
      }),
      stubAdapter('openai', () => okExtraction),
    ]);

    const result = await router.run({ task: 'extract', region: 'global', input: {} });
    expect(result.provider).toBe('openai');
    expect(result.attempts).toEqual([
      { provider: 'google', model: 'gemini-3.7-flash', error: '503 from upstream' },
    ]);
  });

  it('reports every attempt when nothing answers', async () => {
    const router = new ModelRouter(DEFAULT_ROUTING, []);
    await expect(router.run({ task: 'classify', region: 'global', input: {} })).rejects.toThrow(
      /no adapter registered/,
    );
  });

  it('routes a China request to a China provider without the caller asking', async () => {
    const router = new ModelRouter(DEFAULT_ROUTING, [
      stubAdapter('bailian', () => okExtraction),
      stubAdapter('google', () => {
        throw new Error('should never be reached for cn traffic');
      }),
    ]);

    const result = await router.run({ task: 'extract', region: 'cn', input: {} });
    expect(result.provider).toBe('bailian');
  });
});
