/**
 * Demo seed.
 *
 * The same shape as the golden dataset in @kiwi/ledger, but written through
 * the store's public API and dated relative to a given day, so the apps open
 * on a month that has something in it.
 *
 * Amounts match the golden dataset exactly, which means a figure on screen can
 * be checked against the metric tests.
 */

import { monthKey } from '@kiwi/core';
import type { IsoDate } from '@kiwi/core';
import type { LedgerStore } from './store.ts';

const day = (month: string, dayOfMonth: number): IsoDate =>
  `${month}-${String(dayOfMonth).padStart(2, '0')}`;

function previousMonthKey(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}

export interface SeedResult {
  ledgerId: string;
  accountIds: Record<'sgd' | 'savings' | 'cny' | 'jpy', string>;
}

export function seedDemo(store: LedgerStore, today: IsoDate): SeedResult {
  const thisMonth = monthKey(today);
  const lastMonth = previousMonthKey(thisMonth);
  const cat = (ledgerId: string, slug: string) => `${ledgerId}:${slug}`;

  const ledger = store.createLedger({ name: 'Personal', baseCurrency: 'SGD' });
  const id = ledger.id;

  const sgd = store.createAccount({ ledgerId: id, name: 'DBS Multiplier', type: 'debit', currency: 'SGD', openingBalanceMinor: 320_000 });
  const savings = store.createAccount({ ledgerId: id, name: 'Savings', type: 'savings', currency: 'SGD', openingBalanceMinor: 1_500_000 });
  const cny = store.createAccount({ ledgerId: id, name: 'Alipay', type: 'cash', currency: 'CNY', openingBalanceMinor: 480_000 });
  const jpy = store.createAccount({ ledgerId: id, name: 'JPY cash', type: 'cash', currency: 'JPY', openingBalanceMinor: 42_000 });

  const prov = (kind: 'screenshot' | 'photo' | 'email', ref: string, model: string) =>
    store.createProvenance({ ledgerId: id, kind, ref, extractedBy: model }).id;

  store.createBudget({ ledgerId: id, categoryId: null, periodType: 'monthly', amountMinor: 100_000, currency: 'SGD', effectiveFrom: lastMonth });
  store.createBudget({ ledgerId: id, categoryId: cat(id, 'food'), periodType: 'monthly', amountMinor: 30_000, currency: 'SGD', effectiveFrom: lastMonth });

  // --- this month -----------------------------------------------------------
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(thisMonth, 2), amountMinor: -4_500, currency: 'SGD', categoryId: cat(id, 'groceries'), merchantName: 'FairPrice' });
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(thisMonth, 5), amountMinor: -8_850, currency: 'SGD', categoryId: cat(id, 'restaurants'), merchantName: 'Tiong Bahru Bakery' });

  // 30,000 JPY at 0.0090 = 270.00 SGD. JPY has no minor unit.
  store.createTransaction({
    ledgerId: id, accountId: jpy.id, kind: 'expense', date: day(thisMonth, 8),
    amountMinor: -30_000, currency: 'JPY', fxRate: 0.009, fxRateSource: 'card_statement',
    categoryId: cat(id, 'flights'), merchantName: 'JAL', tags: ['travel'],
    source: 'screenshot', provenanceId: prov('screenshot', 'demo/jal-boarding.png', 'stub-extractor@0'), aiConfidence: 0.97,
  });

  // 210.00 CNY at 0.1860 = 39.06 SGD.
  store.createTransaction({
    ledgerId: id, accountId: cny.id, kind: 'expense', date: day(thisMonth, 11),
    amountMinor: -21_000, currency: 'CNY', fxRate: 0.186, fxRateSource: 'card_statement',
    categoryId: cat(id, 'groceries'), merchantName: 'Hema',
    source: 'screenshot', provenanceId: prov('screenshot', 'demo/hema-alipay.png', 'stub-extractor@0'), aiConfidence: 0.91,
  });

  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(thisMonth, 12), amountMinor: -3_200, currency: 'SGD', categoryId: null, merchantName: null, note: 'card reader, no receipt' });
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'income', date: day(thisMonth, 25), amountMinor: 650_000, currency: 'SGD', categoryId: cat(id, 'salary'), merchantName: 'Employer' });

  // Transfer pair — must not read as income or expense.
  const transferLink = 'link-transfer-demo';
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'transfer', date: day(thisMonth, 15), amountMinor: -100_000, currency: 'SGD', linkId: transferLink });
  store.createTransaction({ ledgerId: id, accountId: savings.id, kind: 'transfer', date: day(thisMonth, 15), amountMinor: 100_000, currency: 'SGD', linkId: transferLink });

  // FX trade: 500.00 SGD buys 2,688.00 CNY. The spread is not spending.
  const fxLink = 'link-fx-demo';
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'fx_trade', date: day(thisMonth, 18), amountMinor: -50_000, currency: 'SGD', linkId: fxLink });
  store.createTransaction({ ledgerId: id, accountId: cny.id, kind: 'fx_trade', date: day(thisMonth, 18), amountMinor: 268_800, currency: 'CNY', fxRate: 0.186, fxRateSource: 'card_statement', linkId: fxLink });

  // Waiting in the confirmation queue.
  store.createTransaction({
    ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(thisMonth, 20),
    amountMinor: -2_500, currency: 'SGD', categoryId: cat(id, 'coffee'), merchantName: 'Common Man Coffee',
    source: 'screenshot', provenanceId: prov('photo', 'demo/coffee-receipt.jpg', 'stub-extractor@0'), aiConfidence: 0.42, status: 'pending_review',
  });
  store.createTransaction({
    ledgerId: id, accountId: cny.id, kind: 'expense', date: day(thisMonth, 19),
    amountMinor: -6_800, currency: 'CNY', fxRate: 0.186, fxRateSource: 'card_statement',
    categoryId: null, merchantName: '滴滴出行',
    source: 'screenshot', provenanceId: prov('screenshot', 'demo/didi-wechat.png', 'stub-extractor@0'), aiConfidence: 0.55, status: 'pending_review',
  });

  // --- last month, so period-over-period has something to compare -----------
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(lastMonth, 10), amountMinor: -12_000, currency: 'SGD', categoryId: cat(id, 'groceries'), merchantName: 'FairPrice' });
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'expense', date: day(lastMonth, 14), amountMinor: -6_000, currency: 'SGD', categoryId: cat(id, 'restaurants'), merchantName: 'Tiong Bahru Bakery' });
  store.createTransaction({ ledgerId: id, accountId: sgd.id, kind: 'income', date: day(lastMonth, 25), amountMinor: 650_000, currency: 'SGD', categoryId: cat(id, 'salary'), merchantName: 'Employer' });

  // A correction the user already made, so the fast path has something in it.
  store.learnRule({ ledgerId: id, matchType: 'merchant_exact', pattern: 'FairPrice', categoryId: cat(id, 'groceries') });
  store.learnRule({ ledgerId: id, matchType: 'merchant_contains', pattern: '滴滴', categoryId: cat(id, 'rideshare') });

  return { ledgerId: id, accountIds: { sgd: sgd.id, savings: savings.id, cny: cny.id, jpy: jpy.id } };
}
