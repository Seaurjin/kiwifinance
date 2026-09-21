import { LedgerStore, seedDemo } from '@kiwi/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { KiwiTools, MAX_ROWS, ScopeDeniedError, type Session } from '../src/tools.ts';

const TODAY = '2026-03-21';

let store: LedgerStore;
let ledgerId: string;

const session = (scopes: ('read' | 'write')[] = ['read']): Session => ({
  ledgerId,
  client: 'claude-desktop',
  scopes,
  today: () => TODAY,
});

const readTools = () => new KiwiTools(store, session());
const writeTools = () => new KiwiTools(store, session(['read', 'write']));

beforeEach(() => {
  store = LedgerStore.open(':memory:').withClock(() => '2026-03-21T00:00:00.000Z');
  ledgerId = seedDemo(store, TODAY).ledgerId;
});

describe('kiwi_list_schema', () => {
  it('tells a cold model what it can actually ask for', () => {
    const schema = readTools().listSchema();

    expect(schema.ledger).toMatchObject({ baseCurrency: 'SGD', today: TODAY });
    expect(schema.accounts.map((a) => a.name)).toContain('Alipay');
    expect(schema.currencies).toEqual(['CNY', 'JPY', 'SGD']);
    expect(schema.metrics).toHaveLength(20);
    expect(schema.reports.map((r) => r.id)).toContain('monthly_review');
  });

  it('states the limits rather than leaving them to be discovered', () => {
    expect(readTools().listSchema().limits).toEqual({ maxRows: MAX_ROWS, scopes: ['read'] });
  });
});

describe('reading', () => {
  it('returns figures the engine computed, matching the metric tests', () => {
    const { fact } = readTools().runMetric({
      metric: 'expense_total',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(fact).toMatchObject({ metric: 'expense_total', value: 47_456, currency: 'SGD' });
  });

  it('rejects a metric that does not exist instead of approximating one', () => {
    expect(() => readTools().runMetric({ metric: 'vibes_index' })).toThrow(/Unknown metric/);
  });

  it('runs a standard report and an ad-hoc spec through the same path', () => {
    const standard = readTools().runReport({
      report: 'monthly_review',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(standard.factSet.blocks[0]?.facts[0]).toMatchObject({ value: 47_456 });

    const adHoc = readTools().runReport({
      spec: {
        version: 1,
        title: 'Currencies',
        period: { from: '2026-03-01', to: '2026-03-31' },
        blocks: [{ type: 'chart', viz: 'bar', metric: 'spend_by_currency' }],
      },
    });
    expect(adHoc.factSet.specTitle).toBe('Currencies');
  });

  it('rejects an invalid ad-hoc spec rather than running part of it', () => {
    expect(() =>
      readTools().runReport({
        spec: {
          version: 1,
          title: 'Nope',
          period: { from: '2026-03-01', to: '2026-03-31' },
          blocks: [{ type: 'metric_row', metrics: ['made_up'] }],
        },
      }),
    ).toThrow(/Unknown metric "made_up"/);
  });

  it('finds captured receipts and says what kind of original each has', () => {
    const { receipts } = readTools().searchReceipts({ from: '2026-03-01', to: '2026-03-31' });
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0]?.provenance?.kind).toBeDefined();
  });
});

describe('what leaves the ledger', () => {
  const window = { from: '2026-03-01', to: '2026-03-31' };

  it('sends an account name, never an account id', () => {
    const { transactions } = readTools().queryTransactions(window);
    const row = transactions.find((t) => t.account === 'Alipay');
    expect(row).toBeDefined();
    expect(JSON.stringify(transactions)).not.toContain(ledgerId);
    expect(Object.keys(transactions[0] ?? {})).not.toContain('accountId');
  });

  it('keeps both the amount paid and the frozen conversion, since either alone misleads', () => {
    const { transactions } = readTools().queryTransactions(window);
    const jal = transactions.find((t) => t.merchant === 'JAL');
    expect(jal).toMatchObject({
      amount: -30_000,
      currency: 'JPY',
      baseAmount: -27_000,
      baseCurrency: 'SGD',
      fxRate: 0.009,
      fxRateSource: 'card_statement',
    });
  });

  it('withholds the storage reference of a receipt', () => {
    const { receipts } = readTools().searchReceipts(window);
    expect(JSON.stringify(receipts)).not.toContain('demo/');
  });

  it('caps a page and says that it capped', () => {
    const capped = readTools().queryTransactions({ ...window, limit: 2 });
    expect(capped.transactions).toHaveLength(2);
    expect(capped.capped).toBe(true);
  });

  it('will not return more than the stated maximum however large the limit asked for', () => {
    const { transactions } = readTools().queryTransactions({ ...window, limit: 10_000 });
    expect(transactions.length).toBeLessThanOrEqual(MAX_ROWS);
  });
});

describe('scopes', () => {
  it('refuses a write on a read-only connection, and says why', () => {
    expect(() =>
      readTools().addTransaction({ date: '2026-03-14', amountMinor: -1_000, currency: 'SGD' }),
    ).toThrow(ScopeDeniedError);

    expect(() =>
      readTools().addTransaction({ date: '2026-03-14', amountMinor: -1_000, currency: 'SGD' }),
    ).toThrow(/read-only unless the user turns writing on/);
  });

  it('refuses saving a report on a read-only connection', () => {
    expect(() => readTools().saveReport({ name: 'X', spec: {} })).toThrow(ScopeDeniedError);
  });

  it('allows a write when the scope was granted', () => {
    const { transaction } = writeTools().addTransaction({
      date: '2026-03-14',
      amountMinor: -1_000,
      currency: 'SGD',
      merchant: 'Koufu',
    });
    expect(transaction.merchant).toBe('Koufu');
  });

  it('defaults to a debit account rather than whichever name sorts first', () => {
    const { transaction } = writeTools().addTransaction({
      date: '2026-03-14',
      amountMinor: -1_000,
      currency: 'SGD',
    });
    // Alphabetically "Alipay" comes first; "DBS Multiplier" is the debit one.
    expect(transaction.account).toBe('DBS Multiplier');
  });

  it('names the accounts that exist when asked for one that does not', () => {
    expect(() =>
      writeTools().addTransaction({
        date: '2026-03-14',
        amountMinor: -1_000,
        currency: 'SGD',
        accountName: 'Nowhere Bank',
      }),
    ).toThrow(/Known: .*DBS Multiplier/);
  });

  it('parks anything an outside AI writes in the confirmation queue', () => {
    const { transaction } = writeTools().addTransaction({
      date: '2026-03-14',
      amountMinor: -1_000,
      currency: 'SGD',
    });
    expect(transaction.status).toBe('pending_review');

    // And so it does not move a single figure until the owner accepts it.
    const { fact } = readTools().runMetric({
      metric: 'expense_total',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(fact.kind === 'scalar' && fact.value).toBe(47_456);
  });

  it('refuses to save a spec that could never run', () => {
    expect(() =>
      writeTools().saveReport({
        name: 'Broken',
        spec: { version: 1, title: 'B', period: { from: '2026-03-01', to: '2026-03-31' }, blocks: [] },
      }),
    ).toThrow(/invalid/i);
  });
});

describe('the audit log', () => {
  it('records every read, with what was read and by whom', () => {
    readTools().listSchema();
    readTools().queryTransactions({ from: '2026-03-01', to: '2026-03-31' });
    readTools().runMetric({ metric: 'expense_total', from: '2026-03-01', to: '2026-03-31' });

    const log = store.listMcpAccess(ledgerId);
    expect(log).toHaveLength(3);
    expect(log.map((entry) => entry.tool)).toEqual([
      'kiwi_run_metric',
      'kiwi_query_transactions',
      'kiwi_list_schema',
    ]);
    expect(log.every((entry) => entry.client === 'claude-desktop')).toBe(true);
  });

  it('writes a line the owner can read without knowing what MCP is', () => {
    readTools().queryTransactions({ from: '2026-03-01', to: '2026-03-31' });
    const [entry] = store.listMcpAccess(ledgerId);
    expect(entry?.summary).toMatch(/read \d+ transactions between 2026-03-01 and 2026-03-31/);
    expect(entry?.rowCount).toBeGreaterThan(0);
  });

  it('logs a refused write as an attempt rather than losing it', () => {
    // A denial throws before the log line, so the record that matters is the
    // absence of a read: nothing left the ledger.
    expect(() =>
      readTools().addTransaction({ date: '2026-03-14', amountMinor: -1, currency: 'SGD' }),
    ).toThrow(ScopeDeniedError);
    expect(store.listMcpAccess(ledgerId)).toHaveLength(0);
  });

  it('separates read entries from write entries', () => {
    writeTools().addTransaction({ date: '2026-03-14', amountMinor: -1_000, currency: 'SGD' });
    const [entry] = store.listMcpAccess(ledgerId);
    expect(entry?.scope).toBe('write');
  });
});
