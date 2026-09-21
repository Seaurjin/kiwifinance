/**
 * The ledger model.
 *
 * Two conventions run through every entity here:
 *
 *  1. Amounts are signed. Outflows are negative, inflows positive. This makes
 *     net cash flow a plain sum and removes a whole class of sign bugs from
 *     the metric layer.
 *  2. Nothing is ever hard deleted (FR-LED-12). `deletedAt` hides a row;
 *     the event log keeps the trail.
 */

import type { CurrencyCode, FxRateSource, IsoDate } from '@kiwi/core';

export type Id = string;
/** RFC 3339 instant, e.g. 2026-09-21T14:03:11.000Z. */
export type Instant = string;

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface Ledger {
  readonly id: Id;
  readonly name: string;
  /**
   * The currency every figure is reported in by default. Frozen onto each
   * transaction at write time as `baseCurrency`.
   */
  readonly baseCurrency: CurrencyCode;
  /**
   * Optional second base currency (FR-LED-06 — "living" vs "reporting").
   * When set, reports may be rendered in either. Null means single-base.
   */
  readonly reportingCurrency: CurrencyCode | null;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountType = 'cash' | 'debit' | 'credit' | 'savings';

export interface Account {
  readonly id: Id;
  readonly ledgerId: Id;
  readonly name: string;
  readonly type: AccountType;
  /** Accounts are single-currency. A multi-currency wallet is several accounts. */
  readonly currency: CurrencyCode;
  /** Signed, in `currency`'s minor units. */
  readonly openingBalanceMinor: number;
  readonly archivedAt: Instant | null;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryKind = 'expense' | 'income';

export interface Category {
  readonly id: Id;
  readonly ledgerId: Id | null;
  readonly parentId: Id | null;
  readonly name: string;
  readonly kind: CategoryKind;
  /**
   * Whether spending here is hard to avoid. Drives
   * `essential_vs_discretionary`; user-editable, because what counts as
   * essential is not ours to decide.
   */
  readonly essential: boolean;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionKind =
  /** Money leaving for goods or services. Always negative. */
  | 'expense'
  /** Money arriving. Always positive. */
  | 'income'
  /** One leg of a move between the user's own accounts. Never income or expense. */
  | 'transfer'
  /** One leg of a currency exchange. Never income or expense (FR-LED-04). */
  | 'fx_trade'
  /** Manual balance correction. Excluded from spending analysis. */
  | 'adjustment';

/** Kinds excluded from income and expense totals (FR-LED-08, FR-LED-04). */
export const NON_FLOW_KINDS: ReadonlySet<TransactionKind> = new Set([
  'transfer',
  'fx_trade',
  'adjustment',
]);

/** How the record entered the system. Drives the capture funnel metrics. */
export type CaptureSource =
  | 'manual'
  | 'screenshot'
  | 'photo'
  | 'voice'
  | 'email'
  | 'api'
  | 'bank';

/** Pending rows are the confirmation queue (FR-CAP-08). */
export type TransactionStatus = 'confirmed' | 'pending_review';

export interface Transaction {
  readonly id: Id;
  readonly ledgerId: Id;
  readonly accountId: Id;
  readonly kind: TransactionKind;
  /** Calendar date of the transaction, not of its capture. */
  readonly date: IsoDate;

  // -- Frozen FX columns (P-2, FR-LED-01/02/03). Written once, never recomputed.
  /** Signed, in `currency`'s minor units. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** Major units of baseCurrency per one major unit of `currency`. */
  readonly fxRate: number;
  readonly fxRateSource: FxRateSource;
  readonly fxAsOf: IsoDate;
  /** Signed, in `baseCurrency`'s minor units. Frozen at write time. */
  readonly baseAmountMinor: number;
  readonly baseCurrency: CurrencyCode;

  readonly categoryId: Id | null;
  readonly merchantId: Id | null;
  /** Raw merchant string as captured, kept even after normalisation. */
  readonly merchantName: string | null;
  readonly note: string | null;
  readonly tags: readonly string[];

  /** Ties the two legs of a transfer or FX trade together. */
  readonly linkId: Id | null;
  /** Ties split line items back to the receipt they came from (FR-CAP-03). */
  readonly parentId: Id | null;

  readonly source: CaptureSource;
  /** Deduplication key for re-imported captures (FR-CAP-12). */
  readonly sourceHash: string | null;
  /** 0..1 from the extractor; null for manual entry. */
  readonly aiConfidence: number | null;
  /** Points at the original screenshot, photo, email or API call (FR-CAP-09). */
  readonly provenanceId: Id | null;
  readonly status: TransactionStatus;

  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Merchants and rules
// ---------------------------------------------------------------------------

export interface Merchant {
  readonly id: Id;
  readonly ledgerId: Id;
  /** Normalised name used for matching, e.g. "starbucks". */
  readonly normalizedName: string;
  readonly displayName: string;
  readonly defaultCategoryId: Id | null;
  readonly deletedAt: Instant | null;
}

/**
 * A learned "merchant → category" rule (FR-LED-10). A rule hit means the model
 * is never called, which is where NFR-P-01's 50ms comes from.
 */
export interface CategoryRule {
  readonly id: Id;
  readonly ledgerId: Id;
  readonly matchType: 'merchant_exact' | 'merchant_contains' | 'note_contains';
  readonly pattern: string;
  readonly categoryId: Id;
  /** Higher wins when several rules match. */
  readonly priority: number;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface Budget {
  readonly id: Id;
  readonly ledgerId: Id;
  /** Null means a whole-ledger budget rather than a per-category one. */
  readonly categoryId: Id | null;
  readonly periodType: 'monthly';
  /** Positive, in `currency`'s minor units. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** First month this budget applies to, as YYYY-MM. */
  readonly effectiveFrom: string;
  readonly deletedAt: Instant | null;
}

// ---------------------------------------------------------------------------
// Provenance and audit
// ---------------------------------------------------------------------------

export type ProvenanceKind = 'screenshot' | 'photo' | 'email' | 'api' | 'voice' | 'bank';

export interface Provenance {
  readonly id: Id;
  readonly ledgerId: Id;
  readonly kind: ProvenanceKind;
  /** Storage key or external reference for the original artefact. */
  readonly ref: string;
  readonly capturedAt: Instant;
  /** Model identifier that produced the extraction, for later re-evaluation. */
  readonly extractedBy: string | null;
  readonly deletedAt: Instant | null;
}

/** Append-only. Never updated, never deleted (FR-LED-12, NFR-R-01). */
export interface LedgerEvent {
  readonly id: Id;
  readonly ledgerId: Id;
  readonly entity: 'transaction' | 'account' | 'category' | 'budget' | 'rule';
  readonly entityId: Id;
  readonly op: 'create' | 'update' | 'soft_delete' | 'restore';
  /** JSON snapshot of the change. */
  readonly payload: string;
  readonly at: Instant;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * A materialised, already-filtered view of a ledger that the metric engine
 * runs against. Production builds it from SQLite; tests build it by hand.
 * Deleted rows are excluded before a snapshot is constructed.
 */
export interface LedgerSnapshot {
  readonly ledger: Ledger;
  readonly accounts: readonly Account[];
  readonly categories: readonly Category[];
  readonly transactions: readonly Transaction[];
  readonly budgets: readonly Budget[];
}
