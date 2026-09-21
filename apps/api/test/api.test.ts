import { LedgerStore, seedDemo } from '@kiwi/store';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

const TODAY = '2026-03-21';

let app: FastifyInstance;
let store: LedgerStore;
let ledgerId: string;
let accountId: string;

beforeEach(async () => {
  store = LedgerStore.open(':memory:').withClock(() => '2026-03-21T00:00:00.000Z');
  const seeded = seedDemo(store, TODAY);
  ledgerId = seeded.ledgerId;
  accountId = seeded.accountIds.sgd;
  app = buildServer({ store, today: () => TODAY });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  store.close();
});

const json = <T = Record<string, any>>(response: { payload: string }): T =>
  JSON.parse(response.payload) as T;

describe('health and discovery', () => {
  it('reports the injected day, not the wall clock', async () => {
    expect(json(await app.inject({ url: '/health' }))).toEqual({ ok: true, today: TODAY });
  });

  it('publishes the metric catalogue a planner or MCP client would read', async () => {
    const body = json(await app.inject({ url: '/api/metrics' }));
    expect(body.metrics).toHaveLength(13);
    expect(body.metrics[0]).toHaveProperty('description');
  });

  it('lists the standard reports and says which are still waiting on metrics', async () => {
    const body = json(await app.inject({ url: '/api/reports' }));
    expect(body.standard.map((r: { id: string }) => r.id)).toContain('monthly_review');
    expect(body.pending.map((r: { id: string }) => r.id)).toContain('subscription_audit');
  });
});

describe('transactions', () => {
  it('lists the month and hides pending rows when asked for confirmed', async () => {
    const all = json(await app.inject({ url: `/api/ledgers/${ledgerId}/transactions` }));
    const confirmed = json(
      await app.inject({ url: `/api/ledgers/${ledgerId}/transactions?status=confirmed` }),
    );
    expect(all.transactions.length).toBeGreaterThan(confirmed.transactions.length);
  });

  it('applies a learned rule when none is given, without calling a model', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/transactions`,
      payload: {
        accountId,
        kind: 'expense',
        date: '2026-03-14',
        amountMinor: -2_000,
        currency: 'SGD',
        merchantName: 'FairPrice',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(json(response).transaction.categoryId).toBe(`${ledgerId}:groceries`);
  });

  it('rejects an invalid row with 422 and the invariant that failed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/transactions`,
      payload: { accountId, kind: 'expense', date: '2026-03-14', amountMinor: 500, currency: 'SGD' },
    });
    expect(response.statusCode).toBe(422);
    expect(json(response).error).toBe('expense_sign');
  });

  it('turns a correction into a rule for next time', async () => {
    const created = json(
      await app.inject({
        method: 'POST',
        url: `/api/ledgers/${ledgerId}/transactions`,
        payload: {
          accountId, kind: 'expense', date: '2026-03-14', amountMinor: -1_500,
          currency: 'SGD', merchantName: 'Koufu',
        },
      }),
    ).transaction;

    expect(created.categoryId).toBeNull();

    await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${created.id}`,
      payload: { categoryId: `${ledgerId}:restaurants` },
    });

    expect(store.applyRules(ledgerId, { merchantName: 'Koufu' })).toBe(`${ledgerId}:restaurants`);
  });

  it('deletes recoverably and says so', async () => {
    const id = json(await app.inject({ url: `/api/ledgers/${ledgerId}/transactions` })).transactions[0].id;
    const deleted = await app.inject({ method: 'DELETE', url: `/api/transactions/${id}` });
    expect(json(deleted)).toEqual({ ok: true, recoverable: true });

    await app.inject({ method: 'POST', url: `/api/transactions/${id}/restore` });
    expect(store.getTransaction(id)?.deletedAt).toBeNull();
  });

  it('traces a captured row back to its original artefact', async () => {
    const jal = store
      .listTransactions(ledgerId, { limit: 100 })
      .find((t) => t.merchantName === 'JAL')!;

    const body = json(await app.inject({ url: `/api/transactions/${jal.id}/trace` }));
    expect(body.provenance.kind).toBe('screenshot');
    expect(body.provenance.ref).toBe('demo/jal-boarding.png');
    expect(body.provenance.extractedBy).toBe('stub-extractor@0');
    // The original amount and the frozen conversion both travel with it.
    expect(body.transaction).toMatchObject({
      amountMinor: -30_000,
      currency: 'JPY',
      baseAmountMinor: -27_000,
      baseCurrency: 'SGD',
    });
  });
});

describe('reports', () => {
  it('runs a standard report and returns the same figures the metric tests assert', async () => {
    const body = json(await app.inject({ url: `/api/ledgers/${ledgerId}/reports/monthly_review` }));
    const headline = body.factSet.blocks[0];
    expect(headline.facts[0].metric).toBe('expense_total');
    expect(headline.facts[0].value).toBe(47_456);
    expect(headline.facts[0].currency).toBe('SGD');
  });

  it('carries the comparison period alongside', async () => {
    const body = json(await app.inject({ url: `/api/ledgers/${ledgerId}/reports/monthly_review` }));
    expect(body.factSet.comparisonPeriod).toBeDefined();
    expect(body.factSet.blocks[0].comparisonFacts[0].value).toBe(18_000);
  });

  it('names what is available when a report does not exist', async () => {
    const response = await app.inject({ url: `/api/ledgers/${ledgerId}/reports/subscription_audit` });
    expect(response.statusCode).toBe(404);
    expect(json(response).pending.map((r: { id: string }) => r.id)).toContain('subscription_audit');
  });

  it('runs an ad-hoc spec', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/reports/run`,
      payload: {
        version: 1,
        title: 'Ad hoc',
        period: { from: '2026-03-01', to: '2026-03-31' },
        blocks: [{ type: 'chart', viz: 'bar', metric: 'spend_by_currency' }],
      },
    });
    expect(response.statusCode).toBe(200);
    const rows = json(response).factSet.blocks[0].facts[0].rows;
    expect(rows.map((r: { key: string }) => r.key)).toEqual(['JPY', 'SGD', 'CNY']);
  });

  it('rejects an invented metric with 422 and the offending path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/reports/run`,
      payload: {
        version: 1,
        title: 'Nope',
        period: { from: '2026-03-01', to: '2026-03-31' },
        blocks: [{ type: 'metric_row', metrics: ['vibes_index'] }],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(json(response).violations[0].path).toBe('/blocks/0/metrics/0');
  });
});

describe('capture', () => {
  it('splits one sentence into several drafts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/capture/extract`,
      payload: { text: 'lunch 35, taxi 22, water 3' },
    });

    const body = json(response);
    expect(body.drafts).toHaveLength(3);
    expect(body.drafts[0]).toMatchObject({ amountMinor: -3_500, currency: 'SGD' });
    expect(body.drafts[1].categorySlug).toBe('rideshare');
    expect(body.extractedBy).toBe('stub/stub-parser');
  });

  it('reads a currency symbol and a zero-decimal currency correctly', async () => {
    const body = json(
      await app.inject({
        method: 'POST',
        url: `/api/ledgers/${ledgerId}/capture/extract`,
        payload: { text: 'ramen 1200 JPY, coffee ¥28' },
      }),
    );
    expect(body.drafts[0]).toMatchObject({ amountMinor: -1_200, currency: 'JPY' });
    expect(body.drafts[1]).toMatchObject({ amountMinor: -2_800, currency: 'CNY' });
  });

  it('commits drafts with provenance, and parks the unsure ones for review', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/ledgers/${ledgerId}/capture/commit`,
      payload: {
        accountId,
        source: 'voice',
        extractedBy: 'stub/stub-parser',
        drafts: [
          { amountMinor: -3_500, currency: 'SGD', date: '2026-03-21', merchantName: 'lunch', categorySlug: 'restaurants', confidence: 0.75 },
          { amountMinor: -2_200, currency: 'SGD', date: '2026-03-21', merchantName: 'taxi', categorySlug: 'rideshare', confidence: 0.95 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const [first, second] = json(response).transactions;
    expect(first.status).toBe('pending_review');
    expect(second.status).toBe('confirmed');
    expect(first.provenanceId).not.toBeNull();
    expect(store.getProvenance(first.provenanceId)?.kind).toBe('voice');
  });
});

describe('export', () => {
  it('serves CSV with no paywall, in major units, with the FX columns', async () => {
    const response = await app.inject({ url: `/api/ledgers/${ledgerId}/export.csv` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);

    const lines = response.payload.trim().split('\n');
    expect(lines[0] ?? '').toContain('fx_rate_source');
    // The JPY row keeps its own scale rather than being divided by 100.
    expect(lines.some((line) => line.includes('-30000,JPY,0.009'))).toBe(true);
    expect(lines[0]).toBeDefined();
  });
});
