/**
 * Helpers for working with a materialised ledger snapshot.
 *
 * Everything here is pure and synchronous: the metric engine must never do IO,
 * so all filtering happens against an already-loaded snapshot.
 */

import { containsDate, type Period } from '@kiwi/core';
import { NON_FLOW_KINDS, type Category, type Id, type LedgerSnapshot, type Transaction } from './types.ts';

/** Rows that are visible: not soft-deleted, not awaiting confirmation. */
export function activeTransactions(snapshot: LedgerSnapshot): Transaction[] {
  return snapshot.transactions.filter((t) => t.deletedAt === null && t.status === 'confirmed');
}

/** Rows sitting in the confirmation queue (FR-CAP-08). */
export function pendingTransactions(snapshot: LedgerSnapshot): Transaction[] {
  return snapshot.transactions.filter(
    (t) => t.deletedAt === null && t.status === 'pending_review',
  );
}

export function inPeriod(txns: readonly Transaction[], p: Period): Transaction[] {
  return txns.filter((t) => containsDate(p, t.date));
}

/** Transactions that count as income or expense — transfers and FX legs removed. */
export function flowTransactions(txns: readonly Transaction[]): Transaction[] {
  return txns.filter((t) => !NON_FLOW_KINDS.has(t.kind));
}

export function expenses(txns: readonly Transaction[]): Transaction[] {
  return flowTransactions(txns).filter((t) => t.amountMinor < 0);
}

export function income(txns: readonly Transaction[]): Transaction[] {
  return flowTransactions(txns).filter((t) => t.amountMinor > 0);
}

/** Index categories by id for O(1) lookup during grouping. */
export function categoryIndex(snapshot: LedgerSnapshot): Map<Id, Category> {
  return new Map(snapshot.categories.filter((c) => c.deletedAt === null).map((c) => [c.id, c]));
}

/**
 * Walk a category up to its top-level ancestor. Grouping by top level is what
 * a spending breakdown actually wants — sixty rows is not a breakdown.
 */
export function topLevelCategoryId(index: Map<Id, Category>, categoryId: Id | null): Id | null {
  if (categoryId === null) return null;
  let current = index.get(categoryId);
  if (current === undefined) return null;
  const seen = new Set<Id>([current.id]);
  while (current.parentId !== null) {
    const parent = index.get(current.parentId);
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

/** Every descendant id of a category, including itself. */
export function categoryWithDescendants(index: Map<Id, Category>, rootId: Id): Set<Id> {
  const result = new Set<Id>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of index.values()) {
      if (category.parentId !== null && result.has(category.parentId) && !result.has(category.id)) {
        result.add(category.id);
        grew = true;
      }
    }
  }
  return result;
}
