import { period } from '@kiwi/core';
import { runMetric, type ScalarFact } from '@kiwi/metrics';
import { DuplicateCaptureError, LedgerStore, seedDemo } from '@kiwi/store';
import { beforeEach, describe, expect, it } from 'vitest';

const TODAY = '2026-03-21';
const MONTH = period('2026-03-01', '2026-03-31');

let store: LedgerStore;
let ledgerId: string;
let accountId: string;

beforeEach(() => {
  store = LedgerStore.open(':memory:').withClock(() => '2026-03-21T00:00:00.000Z');
  const seeded = seedDemo(store, TODAY);
  ledgerId = seeded.ledgerId;
  accountId = seeded.accountIds.sgd;
});

describe('seeding', () => {
  it('creates the full category tree', () => {
    const categories = store.listCategories(ledgerId);
    expect(categories.length).toBeGreaterThanOrEqual(60);
    expect(categories.some((c) => c.name === 'Groceries')).toBe(true);
  });

  it('gives seeded categories stable, slug-derived ids', () => {
    expect(store.listCategories(ledgerId).some((c) => c.id === `${ledgerId}:groceries`)).toBe(true);
  });
});

describe('the seeded ledger reproduces the golden figures', () => {
  it('totals spending to the same number the metric tests assert', () => {
    const fact = runMetric('expense_total', {
      snapshot: store.loadSnapshot(ledgerId),
      period: MONTH,
      today: TODAY,
    }) as ScalarFact;
    expect(fact.value).toBe(47_456);
  });

  it('keeps transfers and FX legs out of the total', () => {
    const fact = runMetric('net_cash_flow', {
      snapshot: store.loadSnapshot(ledgerId),
      period: MONTH,
      today: TODAY,
    }) as ScalarFact;
    expect(fact.value).toBe(650_000 - 47_456);
  });
});

describe('writes', () => {
  it('freezes the base amount at write time', () => {
    const txn = store.createTransaction({
      ledgerId,
      accountId,
      kind: 'expense',
      date: '2026-03-14',
      amountMinor: -30_000,
      currency: 'JPY',
      fxRate: 0.009,
      fxRateSource: 'card_statement',
    });
    expect(txn.baseAmountMinor).toBe(-27_000);
    expect(txn.baseCurrency).toBe('SGD');
  });

  it('refuses a foreign-currency row with no rate, rather than inventing one', () => {
    expect(() =>
      store.createTransaction({
        ledgerId,
        accountId,
        kind: 'expense',
        date: '2026-03-14',
        amountMinor: -30_000,
        currency: 'JPY',
      }),
    ).toThrow(/needs an fxRate/);
  });

  it('rejects an invalid row before it reaches the database', () => {
    expect(() =>
      store.createTransaction({
        ledgerId,
        accountId,
        kind: 'expense',
        date: '2026-03-14',
        amountMinor: 5_000, // positive expense
        currency: 'SGD',
      }),
    ).toThrow(/Expenses must be negative/);
  });

  it('refuses a second row for the same capture', () => {
    const provenance = store.createProvenance({
      ledgerId,
      kind: 'screenshot',
      ref: 'test/receipt.png',
    });
    const input = {
      ledgerId,
      accountId,
      kind: 'expense' as const,
      date: '2026-03-14',
      amountMinor: -1_000,
      currency: 'SGD',
      source: 'screenshot' as const,
      provenanceId: provenance.id,
      sourceHash: 'sha256:abc',
    };
    store.createTransaction(input);
    expect(() => store.createTransaction(input)).toThrow(DuplicateCaptureError);
  });
});

describe('soft delete', () => {
  it('hides the row but keeps it recoverable, and logs both moves', () => {
    const txn = store.createTransaction({
      ledgerId, accountId, kind: 'expense', date: '2026-03-14', amountMinor: -1_000, currency: 'SGD',
    });

    store.softDeleteTransaction(txn.id);
    expect(store.listTransactions(ledgerId).some((t) => t.id === txn.id)).toBe(false);
    expect(store.getTransaction(txn.id)?.deletedAt).not.toBeNull();

    store.restoreTransaction(txn.id);
    expect(store.listTransactions(ledgerId).some((t) => t.id === txn.id)).toBe(true);

    // create + soft_delete + restore
    expect(store.countEvents(txn.id)).toBe(3);
  });

  it('keeps a deleted row out of every metric', () => {
    const before = runMetric('expense_total', {
      snapshot: store.loadSnapshot(ledgerId), period: MONTH, today: TODAY,
    }) as ScalarFact;

    const txn = store.createTransaction({
      ledgerId, accountId, kind: 'expense', date: '2026-03-14', amountMinor: -9_900, currency: 'SGD',
    });
    store.softDeleteTransaction(txn.id);

    const after = runMetric('expense_total', {
      snapshot: store.loadSnapshot(ledgerId), period: MONTH, today: TODAY,
    }) as ScalarFact;
    expect(after.value).toBe(before.value);
  });
});

describe('category rules', () => {
  it('matches a learned merchant without calling anything', () => {
    expect(store.applyRules(ledgerId, { merchantName: 'FairPrice' })).toBe(`${ledgerId}:groceries`);
    expect(store.applyRules(ledgerId, { merchantName: 'fairprice' })).toBe(`${ledgerId}:groceries`);
  });

  it('matches on a substring when the rule says so', () => {
    expect(store.applyRules(ledgerId, { merchantName: '滴滴出行' })).toBe(`${ledgerId}:rideshare`);
  });

  it('returns null when nothing matches, so the caller knows to ask a model', () => {
    expect(store.applyRules(ledgerId, { merchantName: 'Somewhere New' })).toBeNull();
  });

  it('replaces a rule rather than stacking a contradictory second one', () => {
    store.learnRule({
      ledgerId, matchType: 'merchant_exact', pattern: 'FairPrice', categoryId: `${ledgerId}:restaurants`,
    });
    expect(store.listRules(ledgerId).filter((r) => r.pattern === 'FairPrice')).toHaveLength(1);
    expect(store.applyRules(ledgerId, { merchantName: 'FairPrice' })).toBe(`${ledgerId}:restaurants`);
  });
});

describe('the confirmation queue', () => {
  it('holds low-confidence captures out of the totals until confirmed', () => {
    const pending = store.listTransactions(ledgerId, { status: 'pending_review' });
    expect(pending).toHaveLength(2);

    const before = (runMetric('expense_total', {
      snapshot: store.loadSnapshot(ledgerId), period: MONTH, today: TODAY,
    }) as ScalarFact).value;

    store.updateTransaction(pending[0]!.id, { status: 'confirmed' });

    const after = (runMetric('expense_total', {
      snapshot: store.loadSnapshot(ledgerId), period: MONTH, today: TODAY,
    }) as ScalarFact).value;

    expect(after).toBeGreaterThan(before!);
  });
});
