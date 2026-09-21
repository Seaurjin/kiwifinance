import { describe, expect, it } from 'vitest';
import {
  DEMO_TRANSACTIONS,
  LedgerInvariantError,
  activeTransactions,
  categoryIndex,
  demoSnapshot,
  expenses,
  flowTransactions,
  flattenSeedCategories,
  income,
  pendingTransactions,
  topLevelCategoryId,
  validateTransaction,
  validateTransactions,
  type Transaction,
} from '@kiwi/ledger';

const base = DEMO_TRANSACTIONS[0] as Transaction;

function withFields(overrides: Partial<Transaction>): Transaction {
  return { ...base, ...overrides };
}

describe('the golden dataset itself', () => {
  it('satisfies every invariant, so a failing metric test is never a bad fixture', () => {
    expect(validateTransactions(DEMO_TRANSACTIONS)).toEqual([]);
  });
});

describe('sign convention', () => {
  it('rejects a positive expense', () => {
    expect(() => validateTransaction(withFields({ kind: 'expense', amountMinor: 100, baseAmountMinor: 100 }))).toThrow(
      LedgerInvariantError,
    );
  });

  it('rejects a negative income', () => {
    expect(() =>
      validateTransaction(withFields({ kind: 'income', amountMinor: -100, baseAmountMinor: -100 })),
    ).toThrow(LedgerInvariantError);
  });

  it('rejects an original and base amount pointing opposite ways', () => {
    expect(() => validateTransaction(withFields({ amountMinor: -100, baseAmountMinor: 100 }))).toThrow(
      /disagree on direction/,
    );
  });
});

describe('frozen FX columns', () => {
  it('rejects a same-currency row carrying a rate other than 1', () => {
    expect(() => validateTransaction(withFields({ fxRate: 1.2 }))).toThrow(/must have fxRate 1/);
  });

  it('rejects a base amount that cannot be reproduced from the stored rate', () => {
    const tampered = withFields({
      currency: 'JPY',
      amountMinor: -30_000,
      fxRate: 0.009,
      baseAmountMinor: -99_999, // should be -27,000
    });
    expect(() => validateTransaction(tampered)).toThrow(/cannot be reproduced/);
  });

  it('accepts the one minor unit of slack a rounding mode can introduce', () => {
    const rounded = withFields({
      currency: 'JPY',
      amountMinor: -30_000,
      fxRate: 0.009,
      baseAmountMinor: -27_001,
    });
    expect(() => validateTransaction(rounded)).not.toThrow();
  });

  it('rejects a non-positive rate', () => {
    expect(() => validateTransaction(withFields({ fxRate: 0 }))).toThrow(/positive finite/);
  });
});

describe('traceability', () => {
  it('rejects an AI-captured row with no provenance', () => {
    expect(() =>
      validateTransaction(withFields({ source: 'screenshot', provenanceId: null })),
    ).toThrow(/provenanceId/);
  });

  it('allows a manual row without provenance', () => {
    expect(() => validateTransaction(withFields({ source: 'manual', provenanceId: null }))).not.toThrow();
  });

  it('requires both legs of a transfer to be linked', () => {
    expect(() => validateTransaction(withFields({ kind: 'transfer', linkId: null }))).toThrow(/linkId/);
  });
});

describe('snapshot selection', () => {
  const snapshot = demoSnapshot();

  it('hides soft-deleted and unconfirmed rows', () => {
    const ids = activeTransactions(snapshot).map((t) => t.id);
    expect(ids).not.toContain('t11'); // pending_review
    expect(ids).not.toContain('t12'); // soft-deleted
  });

  it('surfaces the confirmation queue separately', () => {
    expect(pendingTransactions(snapshot).map((t) => t.id)).toEqual(['t11']);
  });

  it('keeps transfers and FX legs out of income and expense', () => {
    const active = activeTransactions(snapshot);
    const flowIds = flowTransactions(active).map((t) => t.id);
    for (const excluded of ['t7', 't8', 't9', 't10']) {
      expect(flowIds).not.toContain(excluded);
    }
    const expenseIds = expenses(active).map((t) => t.id);
    expect(expenseIds).toEqual(expect.arrayContaining(['t1', 't2', 't3', 't4', 't6', 't13', 't14']));
    expect(expenseIds).not.toContain('t11'); // pending
    expect(expenseIds).not.toContain('t12'); // deleted
    expect(income(active).map((t) => t.id)).toEqual(['t5']);
  });
});

describe('category tree', () => {
  const index = categoryIndex(demoSnapshot());

  it('walks a leaf up to its top level', () => {
    expect(topLevelCategoryId(index, 'cat-groceries')).toBe('cat-food');
    expect(topLevelCategoryId(index, 'cat-food')).toBe('cat-food');
    expect(topLevelCategoryId(index, null)).toBeNull();
    expect(topLevelCategoryId(index, 'cat-missing')).toBeNull();
  });
});

describe('seed categories', () => {
  it('ships the 12 expense groups and one income group the PRD calls for', () => {
    const flat = flattenSeedCategories();
    const tops = flat.filter((c) => c.parentSlug === null);
    expect(tops.filter((c) => c.kind === 'expense')).toHaveLength(12);
    expect(tops.filter((c) => c.kind === 'income')).toHaveLength(1);
    expect(flat.length).toBeGreaterThanOrEqual(60);
  });

  it('has no duplicate slugs', () => {
    const slugs = flattenSeedCategories().map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
