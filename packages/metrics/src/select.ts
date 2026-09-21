/**
 * Selecting the rows a metric runs over.
 *
 * Kept separate from the engine because metrics that compare two periods
 * (month over month) need to re-select for a period other than the context's.
 */

import { containsDate, type Period } from '@kiwi/core';
import { activeTransactions, type LedgerSnapshot, type Transaction } from '@kiwi/ledger';
import type { MetricFilters } from './types.ts';

export function selectTransactions(
  snapshot: LedgerSnapshot,
  period: Period,
  filters: MetricFilters = {},
): Transaction[] {
  const currencies = filters.currencies?.length ? new Set(filters.currencies) : null;
  const accountIds = filters.accountIds?.length ? new Set(filters.accountIds) : null;
  const categoryIds = filters.categoryIds?.length ? new Set(filters.categoryIds) : null;
  const excluded = filters.excludeCategoryIds?.length
    ? new Set(filters.excludeCategoryIds)
    : null;
  const tags = filters.tags?.length ? new Set(filters.tags) : null;

  return activeTransactions(snapshot).filter((txn) => {
    if (!containsDate(period, txn.date)) return false;
    if (currencies !== null && !currencies.has(txn.currency)) return false;
    if (accountIds !== null && !accountIds.has(txn.accountId)) return false;
    if (categoryIds !== null && (txn.categoryId === null || !categoryIds.has(txn.categoryId))) {
      return false;
    }
    if (excluded !== null && txn.categoryId !== null && excluded.has(txn.categoryId)) return false;
    if (tags !== null && !txn.tags.some((tag) => tags.has(tag))) return false;
    return true;
  });
}
