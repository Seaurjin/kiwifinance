/**
 * The golden dataset.
 *
 * A small multi-currency ledger whose every figure can be checked by hand.
 * It is the fixture the metric tests assert against and the seed a developer
 * runs the app on, so the two never drift apart.
 *
 * Deliberately included, because each one has broken a ledger somewhere:
 *   - spending in three currencies, converted at three different rates
 *   - a JPY amount, whose minor unit is the major unit
 *   - a transfer pair, which must not read as income or expense
 *   - an FX trade pair, whose spread must not read as spending
 *   - an uncategorised row
 *   - a row awaiting confirmation, which must not reach any total
 *   - a soft-deleted row, likewise
 *   - a month of prior data, so period-over-period has something to compare
 */

import type { Account, Budget, Category, Ledger, LedgerSnapshot, Transaction } from './types.ts';

const CREATED = '2026-03-01T00:00:00.000Z';

export const DEMO_LEDGER: Ledger = {
  id: 'led-1',
  name: 'Demo',
  baseCurrency: 'SGD',
  reportingCurrency: null,
  createdAt: CREATED,
  deletedAt: null,
};

export const DEMO_ACCOUNTS: Account[] = [
  { id: 'acc-sgd', ledgerId: 'led-1', name: 'DBS Multiplier', type: 'debit', currency: 'SGD', openingBalanceMinor: 1_000_00, archivedAt: null, deletedAt: null },
  { id: 'acc-save', ledgerId: 'led-1', name: 'Savings', type: 'savings', currency: 'SGD', openingBalanceMinor: 0, archivedAt: null, deletedAt: null },
  { id: 'acc-cny', ledgerId: 'led-1', name: 'Alipay', type: 'cash', currency: 'CNY', openingBalanceMinor: 0, archivedAt: null, deletedAt: null },
  { id: 'acc-jpy', ledgerId: 'led-1', name: 'JPY cash', type: 'cash', currency: 'JPY', openingBalanceMinor: 0, archivedAt: null, deletedAt: null },
];

const category = (
  id: string,
  name: string,
  parentId: string | null,
  kind: Category['kind'],
  essential: boolean,
): Category => ({ id, ledgerId: 'led-1', parentId, name, kind, essential, deletedAt: null });

export const DEMO_CATEGORIES: Category[] = [
  category('cat-food', 'Food & Drink', null, 'expense', true),
  category('cat-groceries', 'Groceries', 'cat-food', 'expense', true),
  category('cat-restaurants', 'Restaurants', 'cat-food', 'expense', false),
  category('cat-travel', 'Travel', null, 'expense', false),
  category('cat-flights', 'Flights', 'cat-travel', 'expense', false),
  category('cat-income', 'Income', null, 'income', false),
  category('cat-salary', 'Salary', 'cat-income', 'income', false),
];

interface TxnInput {
  id: string;
  accountId: string;
  kind: Transaction['kind'];
  date: string;
  amountMinor: number;
  currency: string;
  fxRate: number;
  baseAmountMinor: number;
  categoryId?: string | null;
  merchantName?: string | null;
  source?: Transaction['source'];
  provenanceId?: string | null;
  status?: Transaction['status'];
  deletedAt?: string | null;
  linkId?: string | null;
  aiConfidence?: number | null;
  tags?: string[];
}

const txn = (input: TxnInput): Transaction => ({
  id: input.id,
  ledgerId: 'led-1',
  accountId: input.accountId,
  kind: input.kind,
  date: input.date,
  amountMinor: input.amountMinor,
  currency: input.currency,
  fxRate: input.fxRate,
  fxRateSource: input.currency === 'SGD' ? 'manual' : 'card_statement',
  fxAsOf: input.date,
  baseAmountMinor: input.baseAmountMinor,
  baseCurrency: 'SGD',
  categoryId: input.categoryId ?? null,
  merchantId: null,
  merchantName: input.merchantName ?? null,
  note: null,
  tags: input.tags ?? [],
  linkId: input.linkId ?? null,
  parentId: null,
  source: input.source ?? 'manual',
  sourceHash: null,
  aiConfidence: input.aiConfidence ?? null,
  provenanceId: input.provenanceId ?? null,
  status: input.status ?? 'confirmed',
  createdAt: CREATED,
  updatedAt: CREATED,
  deletedAt: input.deletedAt ?? null,
});

// FX rates used below, all quoted as base-per-original:
//   JPY → SGD  0.0090       CNY → SGD  0.1860
export const DEMO_TRANSACTIONS: Transaction[] = [
  // --- March, the period under test -----------------------------------------
  txn({ id: 't1', accountId: 'acc-sgd', kind: 'expense', date: '2026-03-02', amountMinor: -4_500, currency: 'SGD', fxRate: 1, baseAmountMinor: -4_500, categoryId: 'cat-groceries', merchantName: 'FairPrice' }),
  txn({ id: 't2', accountId: 'acc-sgd', kind: 'expense', date: '2026-03-05', amountMinor: -8_850, currency: 'SGD', fxRate: 1, baseAmountMinor: -8_850, categoryId: 'cat-restaurants', merchantName: 'Tiong Bahru Bakery' }),
  // 30,000 JPY at 0.0090 = 270.00 SGD. JPY has no minor unit, which is exactly
  // the case a hard-coded "divide by 100" gets wrong.
  txn({ id: 't3', accountId: 'acc-jpy', kind: 'expense', date: '2026-03-08', amountMinor: -30_000, currency: 'JPY', fxRate: 0.009, baseAmountMinor: -27_000, categoryId: 'cat-flights', merchantName: 'JAL', source: 'screenshot', provenanceId: 'prov-1', aiConfidence: 0.97 }),
  // 210.00 CNY at 0.1860 = 39.06 SGD.
  txn({ id: 't4', accountId: 'acc-cny', kind: 'expense', date: '2026-03-11', amountMinor: -21_000, currency: 'CNY', fxRate: 0.186, baseAmountMinor: -3_906, categoryId: 'cat-groceries', merchantName: 'Hema', source: 'screenshot', provenanceId: 'prov-2', aiConfidence: 0.91 }),
  txn({ id: 't5', accountId: 'acc-sgd', kind: 'income', date: '2026-03-25', amountMinor: 650_000, currency: 'SGD', fxRate: 1, baseAmountMinor: 650_000, categoryId: 'cat-salary', merchantName: 'Employer' }),
  txn({ id: 't6', accountId: 'acc-sgd', kind: 'expense', date: '2026-03-12', amountMinor: -3_200, currency: 'SGD', fxRate: 1, baseAmountMinor: -3_200, categoryId: null }),

  // Transfer pair — must never read as income or expense (FR-LED-08).
  txn({ id: 't7', accountId: 'acc-sgd', kind: 'transfer', date: '2026-03-15', amountMinor: -100_000, currency: 'SGD', fxRate: 1, baseAmountMinor: -100_000, linkId: 'link-transfer' }),
  txn({ id: 't8', accountId: 'acc-save', kind: 'transfer', date: '2026-03-15', amountMinor: 100_000, currency: 'SGD', fxRate: 1, baseAmountMinor: 100_000, linkId: 'link-transfer' }),

  // FX trade: 500.00 SGD buys 2,688.00 CNY. The ~0.03 SGD difference is the
  // spread, and it must not surface as spending (FR-LED-04).
  txn({ id: 't9', accountId: 'acc-sgd', kind: 'fx_trade', date: '2026-03-18', amountMinor: -50_000, currency: 'SGD', fxRate: 1, baseAmountMinor: -50_000, linkId: 'link-fx' }),
  txn({ id: 't10', accountId: 'acc-cny', kind: 'fx_trade', date: '2026-03-18', amountMinor: 268_800, currency: 'CNY', fxRate: 0.186, baseAmountMinor: 49_997, linkId: 'link-fx' }),

  // Awaiting confirmation — excluded from every total (FR-CAP-08).
  txn({ id: 't11', accountId: 'acc-sgd', kind: 'expense', date: '2026-03-20', amountMinor: -2_500, currency: 'SGD', fxRate: 1, baseAmountMinor: -2_500, categoryId: 'cat-restaurants', merchantName: 'Unconfirmed Cafe', source: 'screenshot', provenanceId: 'prov-3', aiConfidence: 0.42, status: 'pending_review' }),

  // Soft-deleted — hidden, recoverable, never counted (FR-LED-12).
  txn({ id: 't12', accountId: 'acc-sgd', kind: 'expense', date: '2026-03-21', amountMinor: -9_900, currency: 'SGD', fxRate: 1, baseAmountMinor: -9_900, categoryId: 'cat-restaurants', merchantName: 'Deleted Diner', deletedAt: '2026-03-22T10:00:00.000Z' }),

  // --- February, for period-over-period -------------------------------------
  txn({ id: 't13', accountId: 'acc-sgd', kind: 'expense', date: '2026-02-10', amountMinor: -12_000, currency: 'SGD', fxRate: 1, baseAmountMinor: -12_000, categoryId: 'cat-groceries', merchantName: 'FairPrice' }),
  txn({ id: 't14', accountId: 'acc-sgd', kind: 'expense', date: '2026-02-14', amountMinor: -6_000, currency: 'SGD', fxRate: 1, baseAmountMinor: -6_000, categoryId: 'cat-restaurants', merchantName: 'Tiong Bahru Bakery' }),
];

export const DEMO_BUDGETS: Budget[] = [
  { id: 'bud-overall', ledgerId: 'led-1', categoryId: null, periodType: 'monthly', amountMinor: 100_000, currency: 'SGD', effectiveFrom: '2026-01', deletedAt: null },
  { id: 'bud-food', ledgerId: 'led-1', categoryId: 'cat-food', periodType: 'monthly', amountMinor: 30_000, currency: 'SGD', effectiveFrom: '2026-01', deletedAt: null },
];

export function demoSnapshot(): LedgerSnapshot {
  return {
    ledger: DEMO_LEDGER,
    accounts: DEMO_ACCOUNTS,
    categories: DEMO_CATEGORIES,
    transactions: DEMO_TRANSACTIONS,
    budgets: DEMO_BUDGETS,
  };
}

/** The period the metric tests run over, and the day they run "today". */
export const DEMO_PERIOD = { from: '2026-03-01', to: '2026-03-31' } as const;
export const DEMO_TODAY = '2026-03-21';
