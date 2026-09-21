/**
 * The MCP tool surface.
 *
 * This is PRD principle P-3 made concrete: the user points their own AI at
 * their own ledger. Because that AI is outside our control, three things are
 * enforced here rather than promised in documentation:
 *
 *   - **Read-only by default.** A write tool refuses unless the session was
 *     granted the write scope separately (FR-OPN-06).
 *   - **Every call is logged** before its result is returned, and the log is
 *     visible in the app (FR-OPN-07). The user's question is "what left my
 *     ledger", so the record is written when the read happens.
 *   - **Results are capped and minimised** (FR-OPN-08). Account ids never
 *     leave; a name does. One call cannot drain the ledger.
 *
 * The tools are plain functions so they can be tested without a transport.
 */

import { monthOf, period as makePeriod, type IsoDate } from '@kiwi/core';
import type { Transaction } from '@kiwi/ledger';
import { defaultRegistry, runMetric, type Fact } from '@kiwi/metrics';
import {
  STANDARD_REPORTS,
  executeSpec,
  parseSpec,
  standardReport,
  type FactSet,
} from '@kiwi/report-spec';
import type { LedgerStore } from '@kiwi/store';

export type Scope = 'read' | 'write';

export interface Session {
  readonly ledgerId: string;
  /** Which client is connected, as shown in the audit log. */
  readonly client: string;
  readonly scopes: readonly Scope[];
  /** Injected, so tests and the app agree on what "today" is. */
  readonly today: () => IsoDate;
}

/** The most rows any single call can return. */
export const MAX_ROWS = 200;

export class ScopeDeniedError extends Error {
  constructor(tool: string) {
    super(
      `"${tool}" needs the write scope, which this connection was not granted. ` +
        `Kiwi connections are read-only unless the user turns writing on, and they can turn it off again at any time.`,
    );
    this.name = 'ScopeDeniedError';
  }
}

/**
 * What a transaction looks like once it leaves the ledger.
 * Account and provenance ids stay behind: an outside model has no use for an
 * internal identifier, and every field that leaves is a field that can leak.
 */
export interface ExportedTransaction {
  id: string;
  date: string;
  kind: string;
  amount: number;
  currency: string;
  baseAmount: number;
  baseCurrency: string;
  fxRate: number;
  fxRateSource: string;
  category: string | null;
  merchant: string | null;
  note: string | null;
  tags: string[];
  account: string;
  status: string;
}

export class KiwiTools {
  readonly #store: LedgerStore;
  readonly #session: Session;
  readonly #accountNames: Map<string, string>;
  readonly #categoryNames: Map<string, string>;

  constructor(store: LedgerStore, session: Session) {
    this.#store = store;
    this.#session = session;
    this.#accountNames = new Map(
      store.listAccounts(session.ledgerId).map((account) => [account.id, account.name]),
    );
    this.#categoryNames = new Map(
      store.listCategories(session.ledgerId).map((category) => [category.id, category.name]),
    );
  }

  #requireWrite(tool: string): void {
    if (!this.#session.scopes.includes('write')) throw new ScopeDeniedError(tool);
  }

  #log(tool: string, scope: Scope, summary: string, rowCount = 0): void {
    this.#store.recordMcpAccess({
      ledgerId: this.#session.ledgerId,
      client: this.#session.client,
      tool,
      scope,
      summary,
      rowCount,
    });
  }

  #export(txn: Transaction): ExportedTransaction {
    return {
      id: txn.id,
      date: txn.date,
      kind: txn.kind,
      amount: txn.amountMinor,
      currency: txn.currency,
      baseAmount: txn.baseAmountMinor,
      baseCurrency: txn.baseCurrency,
      fxRate: txn.fxRate,
      fxRateSource: txn.fxRateSource,
      category: txn.categoryId === null ? null : (this.#categoryNames.get(txn.categoryId) ?? null),
      merchant: txn.merchantName,
      note: txn.note,
      tags: [...txn.tags],
      account: this.#accountNames.get(txn.accountId) ?? 'Unknown',
      status: txn.status,
    };
  }

  #period(input: { from?: string | undefined; to?: string | undefined }): {
    from: IsoDate;
    to: IsoDate;
  } {
    if (input.from !== undefined && input.to !== undefined) return makePeriod(input.from, input.to);
    return monthOf(this.#session.today());
  }

  // -------------------------------------------------------------------------
  // Read tools
  // -------------------------------------------------------------------------

  /**
   * Always call this first. It is the difference between an AI that asks a
   * good question and one that guesses at field names.
   */
  listSchema(): {
    ledger: { name: string; baseCurrency: string; today: string };
    accounts: { name: string; type: string; currency: string }[];
    categories: { id: string; name: string; parent: string | null; kind: string }[];
    currencies: string[];
    tags: string[];
    metrics: ReturnType<typeof defaultRegistry.catalogue>;
    reports: { id: string; title: string; description: string }[];
    limits: { maxRows: number; scopes: readonly Scope[] };
  } {
    const ledger = this.#store.getLedger(this.#session.ledgerId);
    if (ledger === null) throw new Error(`No ledger ${this.#session.ledgerId}.`);

    const transactions = this.#store.listTransactions(this.#session.ledgerId, { limit: 10_000 });
    const categories = this.#store.listCategories(this.#session.ledgerId);

    this.#log('kiwi_list_schema', 'read', 'read the ledger structure');

    return {
      ledger: { name: ledger.name, baseCurrency: ledger.baseCurrency, today: this.#session.today() },
      accounts: this.#store
        .listAccounts(this.#session.ledgerId)
        .map(({ name, type, currency }) => ({ name, type, currency })),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        parent: category.parentId === null ? null : (this.#categoryNames.get(category.parentId) ?? null),
        kind: category.kind,
      })),
      currencies: [...new Set(transactions.map((txn) => txn.currency))].sort(),
      tags: [...new Set(transactions.flatMap((txn) => txn.tags))].sort(),
      metrics: defaultRegistry.catalogue(),
      reports: STANDARD_REPORTS.map(({ id, title, description }) => ({ id, title, description })),
      limits: { maxRows: MAX_ROWS, scopes: this.#session.scopes },
    };
  }

  queryTransactions(input: {
    from?: string | undefined;
    to?: string | undefined;
    merchant?: string | undefined;
    currency?: string | undefined;
    limit?: number | undefined;
  }): { transactions: ExportedTransaction[]; returned: number; capped: boolean } {
    const window = this.#period(input);
    const limit = Math.min(input.limit ?? 50, MAX_ROWS);

    let rows = this.#store.listTransactions(this.#session.ledgerId, {
      from: window.from,
      to: window.to,
      limit: MAX_ROWS + 1,
    });

    if (input.merchant !== undefined) {
      const needle = input.merchant.toLowerCase();
      rows = rows.filter((txn) => (txn.merchantName ?? '').toLowerCase().includes(needle));
    }
    if (input.currency !== undefined) {
      rows = rows.filter((txn) => txn.currency === input.currency);
    }

    const capped = rows.length > limit;
    const page = rows.slice(0, limit);

    this.#log(
      'kiwi_query_transactions',
      'read',
      `read ${page.length} transactions between ${window.from} and ${window.to}`,
      page.length,
    );

    return { transactions: page.map((txn) => this.#export(txn)), returned: page.length, capped };
  }

  runMetric(input: {
    metric: string;
    from?: string | undefined;
    to?: string | undefined;
    params?: Record<string, unknown> | undefined;
  }): { fact: Fact } {
    const window = this.#period(input);
    // An unknown id throws here rather than returning an approximation.
    const fact = runMetric(input.metric, {
      snapshot: this.#store.loadSnapshot(this.#session.ledgerId),
      period: makePeriod(window.from, window.to),
      today: this.#session.today(),
      ...(input.params !== undefined ? { params: input.params } : {}),
    });

    this.#log(
      'kiwi_run_metric',
      'read',
      `computed ${input.metric} for ${window.from} to ${window.to}`,
      fact.sourceTxnIds.length,
    );

    return { fact };
  }

  runReport(input: {
    report?: string | undefined;
    spec?: unknown;
    from?: string | undefined;
    to?: string | undefined;
  }): { factSet: FactSet } {
    const ledger = this.#store.getLedger(this.#session.ledgerId);
    if (ledger === null) throw new Error(`No ledger ${this.#session.ledgerId}.`);

    let spec: unknown;
    let label: string;

    if (input.spec !== undefined) {
      // Validated the same way a planner's output is: invalid is rejected.
      spec = parseSpec(input.spec);
      label = 'an ad-hoc report';
    } else {
      const report = standardReport(input.report ?? '');
      if (report === undefined) {
        throw new Error(
          `No report "${input.report}". Available: ${STANDARD_REPORTS.map((r) => r.id).join(', ')}.`,
        );
      }
      spec = report.build(this.#period(input), ledger.baseCurrency);
      label = report.title;
    }

    const factSet = executeSpec(spec, {
      snapshot: this.#store.loadSnapshot(this.#session.ledgerId),
      today: this.#session.today(),
    });

    this.#log('kiwi_run_report', 'read', `ran ${label}`, factSet.blocks.length);
    return { factSet };
  }

  searchReceipts(input: {
    merchant?: string | undefined;
    minAmount?: number | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): {
    receipts: { transaction: ExportedTransaction; provenance: { kind: string; capturedAt: string } | null }[];
  } {
    const window = this.#period(input);
    let rows = this.#store
      .listTransactions(this.#session.ledgerId, { from: window.from, to: window.to, limit: MAX_ROWS })
      .filter((txn) => txn.provenanceId !== null);

    if (input.merchant !== undefined) {
      const needle = input.merchant.toLowerCase();
      rows = rows.filter((txn) => (txn.merchantName ?? '').toLowerCase().includes(needle));
    }
    if (input.minAmount !== undefined) {
      rows = rows.filter((txn) => Math.abs(txn.baseAmountMinor) >= (input.minAmount ?? 0));
    }

    this.#log('kiwi_search_receipts', 'read', `found ${rows.length} captured receipts`, rows.length);

    return {
      receipts: rows.map((txn) => {
        const provenance = txn.provenanceId === null ? null : this.#store.getProvenance(txn.provenanceId);
        return {
          transaction: this.#export(txn),
          // The storage reference stays behind; what the AI needs is that an
          // original exists and where it came from.
          provenance:
            provenance === null ? null : { kind: provenance.kind, capturedAt: provenance.capturedAt },
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Write tools — refused unless the write scope was granted
  // -------------------------------------------------------------------------

  addTransaction(input: {
    date: string;
    amountMinor: number;
    currency: string;
    accountName?: string | undefined;
    merchant?: string | undefined;
    categoryId?: string | undefined;
    note?: string | undefined;
    fxRate?: number | undefined;
  }): { transaction: ExportedTransaction } {
    this.#requireWrite('kiwi_add_transaction');

    const accounts = this.#store.listAccounts(this.#session.ledgerId);
    // Accounts come back sorted by name, so "the first one" would be whichever
    // happens to sort first. A debit account is what "my account" usually
    // means; the caller can name one explicitly when it matters.
    const account =
      input.accountName === undefined
        ? (accounts.find((candidate) => candidate.type === 'debit') ?? accounts[0])
        : accounts.find((candidate) => candidate.name === input.accountName);
    if (account === undefined) {
      throw new Error(
        `No account named "${input.accountName}". Known: ${accounts.map((a) => a.name).join(', ')}.`,
      );
    }

    const created = this.#store.createTransaction({
      ledgerId: this.#session.ledgerId,
      accountId: account.id,
      kind: input.amountMinor > 0 ? 'income' : 'expense',
      date: input.date,
      amountMinor: input.amountMinor,
      currency: input.currency,
      ...(input.fxRate !== undefined ? { fxRate: input.fxRate } : {}),
      categoryId:
        input.categoryId ??
        this.#store.applyRules(this.#session.ledgerId, {
          merchantName: input.merchant ?? null,
          note: input.note ?? null,
        }),
      merchantName: input.merchant ?? null,
      note: input.note ?? null,
      source: 'api',
      // Anything an outside AI writes waits for the user, whatever it says
      // about its own confidence.
      status: 'pending_review',
      provenanceId: this.#store.createProvenance({
        ledgerId: this.#session.ledgerId,
        kind: 'api',
        ref: `mcp:${this.#session.client}`,
        extractedBy: this.#session.client,
      }).id,
    });

    this.#log('kiwi_add_transaction', 'write', `added a transaction dated ${input.date}`, 1);
    return { transaction: this.#export(created) };
  }

  saveReport(input: { name: string; spec: unknown }): { id: string; name: string } {
    this.#requireWrite('kiwi_save_report');
    // Saving an invalid spec would store a report that can never run.
    const spec = parseSpec(input.spec);
    const saved = this.#store.saveReport({
      ledgerId: this.#session.ledgerId,
      name: input.name,
      spec,
      createdBy: this.#session.client,
    });

    this.#log('kiwi_save_report', 'write', `saved the report "${input.name}"`, 1);
    return { id: saved.id, name: saved.name };
  }
}
