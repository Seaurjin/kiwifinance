/**
 * The SQLite store.
 *
 * Built on node:sqlite, so there is no native module to compile and the API,
 * the tests and a developer's machine all run the same engine.
 *
 * Two rules this file exists to keep:
 *   - every write goes through `validateTransaction` first, so an invalid row
 *     cannot reach the database even via a bug in a caller (FR-LED-01/13);
 *   - every write appends to `event_log` in the same transaction, so nothing
 *     is ever unrecoverable (FR-LED-12, NFR-R-01).
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convert, fxRate, money, type FxRateSource, type IsoDate } from '@kiwi/core';
import {
  flattenSeedCategories,
  validateTransaction,
  type Account,
  type Budget,
  type Category,
  type CategoryRule,
  type Ledger,
  type LedgerSnapshot,
  type Provenance,
  type Transaction,
  type TransactionKind,
  type CaptureSource,
} from '@kiwi/ledger';

const SCHEMA_PATH = fileURLToPath(new URL('../../ledger/src/schema.sql', import.meta.url));

/**
 * node:sqlite is still flagged experimental, so it is absent from
 * module.builtinModules and bundlers try to resolve it as a file on disk.
 * Requiring it at runtime keeps it out of the module graph, and the minimal
 * interface below states exactly what this file uses, so nothing depends on
 * typings that are still in flux.
 */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type DatabaseSyncCtor = new (path: string) => SqliteDatabase;

const nodeRequire = createRequire(import.meta.url);

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: DatabaseSyncCtor };
  return new DatabaseSync(path);
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => String(value);
const nullableStr = (value: unknown): string | null => (value === null ? null : String(value));
const num = (value: unknown): number => Number(value);
const nullableNum = (value: unknown): number | null => (value === null ? null : Number(value));

function toTransaction(row: Row): Transaction {
  return {
    id: str(row['id']),
    ledgerId: str(row['ledger_id']),
    accountId: str(row['account_id']),
    kind: str(row['kind']) as TransactionKind,
    date: str(row['date']),
    amountMinor: num(row['amount_minor']),
    currency: str(row['currency']),
    fxRate: num(row['fx_rate']),
    fxRateSource: str(row['fx_rate_source']) as FxRateSource,
    fxAsOf: str(row['fx_as_of']),
    baseAmountMinor: num(row['base_amount_minor']),
    baseCurrency: str(row['base_currency']),
    categoryId: nullableStr(row['category_id']),
    merchantId: nullableStr(row['merchant_id']),
    merchantName: nullableStr(row['merchant_name']),
    note: nullableStr(row['note']),
    tags: JSON.parse(str(row['tags'])) as string[],
    linkId: nullableStr(row['link_id']),
    parentId: nullableStr(row['parent_id']),
    source: str(row['source']) as CaptureSource,
    sourceHash: nullableStr(row['source_hash']),
    aiConfidence: nullableNum(row['ai_confidence']),
    provenanceId: nullableStr(row['provenance_id']),
    status: str(row['status']) as Transaction['status'],
    createdAt: str(row['created_at']),
    updatedAt: str(row['updated_at']),
    deletedAt: nullableStr(row['deleted_at']),
  };
}

export interface NewTransaction {
  ledgerId: string;
  accountId: string;
  kind: TransactionKind;
  date: IsoDate;
  /** Signed, in the original currency's minor units. */
  amountMinor: number;
  currency: string;
  /** Omitted when the currency equals the ledger base; then the rate is 1. */
  fxRate?: number;
  fxRateSource?: FxRateSource;
  fxAsOf?: IsoDate;
  categoryId?: string | null;
  merchantName?: string | null;
  note?: string | null;
  tags?: string[];
  linkId?: string | null;
  parentId?: string | null;
  source?: CaptureSource;
  sourceHash?: string | null;
  aiConfidence?: number | null;
  provenanceId?: string | null;
  status?: Transaction['status'];
}

export interface SavedReport {
  id: string;
  ledgerId: string;
  name: string;
  spec: unknown;
  /** "user" or the MCP client that saved it. */
  createdBy: string;
  createdAt: string;
}

export interface McpAccessEntry {
  id: string;
  ledgerId: string;
  client: string;
  tool: string;
  scope: 'read' | 'write';
  /** Human-readable, as shown in the app: "read 218 transactions in March". */
  summary: string;
  rowCount: number;
  at: string;
}

export interface TransactionQuery {
  from?: IsoDate;
  to?: IsoDate;
  status?: Transaction['status'];
  limit?: number;
  offset?: number;
}

export class DuplicateCaptureError extends Error {
  constructor(readonly existingId: string) {
    super(`This capture was already recorded as ${existingId}.`);
    this.name = 'DuplicateCaptureError';
  }
}

export class LedgerStore {
  readonly #db: SqliteDatabase;
  #now: () => string = () => new Date().toISOString();

  constructor(db: SqliteDatabase) {
    this.#db = db;
    this.#db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  }

  static open(path = ':memory:'): LedgerStore {
    return new LedgerStore(openDatabase(path));
  }

  /** Freeze the clock. Tests need reproducible timestamps. */
  withClock(now: () => string): this {
    this.#now = now;
    return this;
  }

  close(): void {
    this.#db.close();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  createLedger(input: { name: string; baseCurrency: string; reportingCurrency?: string | null }): Ledger {
    const ledger: Ledger = {
      id: randomUUID(),
      name: input.name,
      baseCurrency: input.baseCurrency,
      reportingCurrency: input.reportingCurrency ?? null,
      createdAt: this.#now(),
      deletedAt: null,
    };
    this.#db
      .prepare(
        `INSERT INTO ledger (id, name, base_currency, reporting_currency, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ledger.id, ledger.name, ledger.baseCurrency, ledger.reportingCurrency, ledger.createdAt);
    this.#seedCategories(ledger.id);
    return ledger;
  }

  #seedCategories(ledgerId: string): void {
    const insert = this.#db.prepare(
      `INSERT INTO category (id, ledger_id, parent_id, name, kind, essential) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const ids = new Map<string, string>();
    for (const seed of flattenSeedCategories()) {
      // Slug-derived ids keep a seeded category stable across installs, which
      // is what lets an extractor return "groceries" and have it resolve.
      const id = `${ledgerId}:${seed.slug}`;
      ids.set(seed.slug, id);
      insert.run(
        id,
        ledgerId,
        seed.parentSlug === null ? null : (ids.get(seed.parentSlug) ?? null),
        seed.name,
        seed.kind,
        seed.essential ? 1 : 0,
      );
    }
  }

  createAccount(input: Omit<Account, 'id' | 'archivedAt' | 'deletedAt'>): Account {
    const account: Account = { ...input, id: randomUUID(), archivedAt: null, deletedAt: null };
    this.#db
      .prepare(
        `INSERT INTO account (id, ledger_id, name, type, currency, opening_balance_minor)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id,
        account.ledgerId,
        account.name,
        account.type,
        account.currency,
        account.openingBalanceMinor,
      );
    return account;
  }

  /**
   * The original artefact a captured row came from (FR-CAP-09). A transaction
   * whose source is not manual must point at one of these, which is why the
   * foreign key exists: a capture with no recoverable original is not
   * traceable, and the promise that every figure can be opened up depends on
   * this row being there.
   */
  createProvenance(input: {
    ledgerId: string;
    kind: Provenance['kind'];
    ref: string;
    extractedBy?: string | null;
  }): Provenance {
    const provenance: Provenance = {
      id: randomUUID(),
      ledgerId: input.ledgerId,
      kind: input.kind,
      ref: input.ref,
      capturedAt: this.#now(),
      extractedBy: input.extractedBy ?? null,
      deletedAt: null,
    };
    this.#db
      .prepare(
        `INSERT INTO provenance (id, ledger_id, kind, ref, captured_at, extracted_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        provenance.id,
        provenance.ledgerId,
        provenance.kind,
        provenance.ref,
        provenance.capturedAt,
        provenance.extractedBy,
      );
    return provenance;
  }

  getProvenance(id: string): Provenance | null {
    const row = this.#db.prepare(`SELECT * FROM provenance WHERE id = ?`).get(id) as Row | undefined;
    if (row === undefined) return null;
    return {
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      kind: str(row['kind']) as Provenance['kind'],
      ref: str(row['ref']),
      capturedAt: str(row['captured_at']),
      extractedBy: nullableStr(row['extracted_by']),
      deletedAt: nullableStr(row['deleted_at']),
    };
  }

  createBudget(input: Omit<Budget, 'id' | 'deletedAt'>): Budget {
    const budget: Budget = { ...input, id: randomUUID(), deletedAt: null };
    this.#db
      .prepare(
        `INSERT INTO budget (id, ledger_id, category_id, period_type, amount_minor, currency, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        budget.id,
        budget.ledgerId,
        budget.categoryId,
        budget.periodType,
        budget.amountMinor,
        budget.currency,
        budget.effectiveFrom,
      );
    return budget;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  getLedger(id: string): Ledger | null {
    const row = this.#db.prepare(`SELECT * FROM ledger WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
    if (row === undefined) return null;
    return {
      id: str(row['id']),
      name: str(row['name']),
      baseCurrency: str(row['base_currency']),
      reportingCurrency: nullableStr(row['reporting_currency']),
      createdAt: str(row['created_at']),
      deletedAt: nullableStr(row['deleted_at']),
    };
  }

  listLedgers(): Ledger[] {
    const rows = this.#db.prepare(`SELECT id FROM ledger WHERE deleted_at IS NULL ORDER BY created_at`).all() as Row[];
    return rows.map((row) => this.getLedger(str(row['id']))!);
  }

  listAccounts(ledgerId: string): Account[] {
    const rows = this.#db
      .prepare(`SELECT * FROM account WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY name`)
      .all(ledgerId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      name: str(row['name']),
      type: str(row['type']) as Account['type'],
      currency: str(row['currency']),
      openingBalanceMinor: num(row['opening_balance_minor']),
      archivedAt: nullableStr(row['archived_at']),
      deletedAt: nullableStr(row['deleted_at']),
    }));
  }

  listCategories(ledgerId: string): Category[] {
    const rows = this.#db
      .prepare(`SELECT * FROM category WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY name`)
      .all(ledgerId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: nullableStr(row['ledger_id']),
      parentId: nullableStr(row['parent_id']),
      name: str(row['name']),
      kind: str(row['kind']) as Category['kind'],
      essential: num(row['essential']) === 1,
      deletedAt: nullableStr(row['deleted_at']),
    }));
  }

  listBudgets(ledgerId: string): Budget[] {
    const rows = this.#db
      .prepare(`SELECT * FROM budget WHERE ledger_id = ? AND deleted_at IS NULL`)
      .all(ledgerId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      categoryId: nullableStr(row['category_id']),
      periodType: 'monthly',
      amountMinor: num(row['amount_minor']),
      currency: str(row['currency']),
      effectiveFrom: str(row['effective_from']),
      deletedAt: nullableStr(row['deleted_at']),
    }));
  }

  listTransactions(ledgerId: string, query: TransactionQuery = {}): Transaction[] {
    const clauses = ['ledger_id = ?', 'deleted_at IS NULL'];
    const params: (string | number)[] = [ledgerId];
    if (query.from !== undefined) {
      clauses.push('date >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      clauses.push('date <= ?');
      params.push(query.to);
    }
    if (query.status !== undefined) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    params.push(query.limit ?? 200, query.offset ?? 0);

    const rows = this.#db
      .prepare(
        `SELECT * FROM txn WHERE ${clauses.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params) as Row[];
    return rows.map(toTransaction);
  }

  getTransaction(id: string): Transaction | null {
    const row = this.#db.prepare(`SELECT * FROM txn WHERE id = ?`).get(id) as Row | undefined;
    return row === undefined ? null : toTransaction(row);
  }

  getTransactions(ids: readonly string[]): Transaction[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.#db.prepare(`SELECT * FROM txn WHERE id IN (${placeholders})`).all(...ids) as Row[];
    return rows.map(toTransaction);
  }

  /** Everything the metric engine needs, in one read. */
  loadSnapshot(ledgerId: string): LedgerSnapshot {
    const ledger = this.getLedger(ledgerId);
    if (ledger === null) throw new Error(`No ledger ${ledgerId}.`);
    const rows = this.#db
      .prepare(`SELECT * FROM txn WHERE ledger_id = ? AND deleted_at IS NULL`)
      .all(ledgerId) as Row[];
    return {
      ledger,
      accounts: this.listAccounts(ledgerId),
      categories: this.listCategories(ledgerId),
      transactions: rows.map(toTransaction),
      budgets: this.listBudgets(ledgerId),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  createTransaction(input: NewTransaction): Transaction {
    const ledger = this.getLedger(input.ledgerId);
    if (ledger === null) throw new Error(`No ledger ${input.ledgerId}.`);

    if (input.sourceHash != null) {
      const existing = this.#db
        .prepare(`SELECT id FROM txn WHERE ledger_id = ? AND source_hash = ? AND deleted_at IS NULL`)
        .get(input.ledgerId, input.sourceHash) as Row | undefined;
      if (existing !== undefined) throw new DuplicateCaptureError(str(existing['id']));
    }

    const sameCurrency = input.currency === ledger.baseCurrency;
    const rate = sameCurrency ? 1 : (input.fxRate ?? 0);
    if (!sameCurrency && rate <= 0) {
      throw new Error(
        `A ${input.currency} transaction in a ${ledger.baseCurrency} ledger needs an fxRate. ` +
          `Without one the base amount cannot be frozen, and FR-LED-03 forbids deriving it later.`,
      );
    }

    const asOf = input.fxAsOf ?? input.date;
    const baseAmountMinor = sameCurrency
      ? input.amountMinor
      : convert(
          money(input.amountMinor, input.currency),
          fxRate({
            from: input.currency,
            to: ledger.baseCurrency,
            rate,
            source: input.fxRateSource ?? 'manual',
            asOf,
          }),
        ).amountMinor;

    const now = this.#now();
    const txn: Transaction = {
      id: randomUUID(),
      ledgerId: input.ledgerId,
      accountId: input.accountId,
      kind: input.kind,
      date: input.date,
      amountMinor: input.amountMinor,
      currency: input.currency,
      fxRate: rate,
      fxRateSource: input.fxRateSource ?? 'manual',
      fxAsOf: asOf,
      baseAmountMinor,
      baseCurrency: ledger.baseCurrency,
      categoryId: input.categoryId ?? null,
      merchantId: null,
      merchantName: input.merchantName ?? null,
      note: input.note ?? null,
      tags: input.tags ?? [],
      linkId: input.linkId ?? null,
      parentId: input.parentId ?? null,
      source: input.source ?? 'manual',
      sourceHash: input.sourceHash ?? null,
      aiConfidence: input.aiConfidence ?? null,
      provenanceId: input.provenanceId ?? null,
      status: input.status ?? 'confirmed',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    validateTransaction(txn);

    this.#db
      .prepare(
        `INSERT INTO txn (
           id, ledger_id, account_id, kind, date,
           amount_minor, currency, fx_rate, fx_rate_source, fx_as_of, base_amount_minor, base_currency,
           category_id, merchant_id, merchant_name, note, tags,
           link_id, parent_id, source, source_hash, ai_confidence, provenance_id, status,
           created_at, updated_at
         ) VALUES (?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?)`,
      )
      .run(
        txn.id, txn.ledgerId, txn.accountId, txn.kind, txn.date,
        txn.amountMinor, txn.currency, txn.fxRate, txn.fxRateSource, txn.fxAsOf, txn.baseAmountMinor, txn.baseCurrency,
        txn.categoryId, txn.merchantId, txn.merchantName, txn.note, JSON.stringify(txn.tags),
        txn.linkId, txn.parentId, txn.source, txn.sourceHash, txn.aiConfidence, txn.provenanceId, txn.status,
        txn.createdAt, txn.updatedAt,
      );

    this.#appendEvent(txn.ledgerId, 'transaction', txn.id, 'create', txn);
    return txn;
  }

  updateTransaction(
    id: string,
    patch: Partial<Pick<Transaction, 'categoryId' | 'merchantName' | 'note' | 'tags' | 'status' | 'date'>>,
  ): Transaction {
    const current = this.getTransaction(id);
    if (current === null || current.deletedAt !== null) throw new Error(`No transaction ${id}.`);

    const next: Transaction = { ...current, ...patch, updatedAt: this.#now() };
    validateTransaction(next);

    this.#db
      .prepare(
        `UPDATE txn SET category_id = ?, merchant_name = ?, note = ?, tags = ?, status = ?, date = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.categoryId,
        next.merchantName,
        next.note,
        JSON.stringify(next.tags),
        next.status,
        next.date,
        next.updatedAt,
        id,
      );

    this.#appendEvent(next.ledgerId, 'transaction', id, 'update', { before: current, after: next });
    return next;
  }

  /** Hides the row. The data stays, and the event log records who hid it. */
  softDeleteTransaction(id: string): void {
    const current = this.getTransaction(id);
    if (current === null) throw new Error(`No transaction ${id}.`);
    const at = this.#now();
    this.#db.prepare(`UPDATE txn SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(at, at, id);
    this.#appendEvent(current.ledgerId, 'transaction', id, 'soft_delete', current);
  }

  restoreTransaction(id: string): void {
    const current = this.getTransaction(id);
    if (current === null) throw new Error(`No transaction ${id}.`);
    this.#db.prepare(`UPDATE txn SET deleted_at = NULL, updated_at = ? WHERE id = ?`).run(this.#now(), id);
    this.#appendEvent(current.ledgerId, 'transaction', id, 'restore', current);
  }

  #appendEvent(
    ledgerId: string,
    entity: string,
    entityId: string,
    op: string,
    payload: unknown,
  ): void {
    this.#db
      .prepare(`INSERT INTO event_log (id, ledger_id, entity, entity_id, op, payload, at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ledgerId, entity, entityId, op, JSON.stringify(payload), this.#now());
  }

  countEvents(entityId: string): number {
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM event_log WHERE entity_id = ?`).get(entityId) as Row;
    return num(row['n']);
  }

  // -------------------------------------------------------------------------
  // Saved reports (FR-ANA-08)
  // -------------------------------------------------------------------------

  saveReport(input: {
    ledgerId: string;
    name: string;
    spec: unknown;
    createdBy: string;
  }): SavedReport {
    const report: SavedReport = {
      id: randomUUID(),
      ledgerId: input.ledgerId,
      name: input.name,
      spec: input.spec,
      createdBy: input.createdBy,
      createdAt: this.#now(),
    };
    this.#db
      .prepare(
        `INSERT INTO saved_report (id, ledger_id, name, spec, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id, report.ledgerId, report.name,
        JSON.stringify(report.spec), report.createdBy, report.createdAt,
      );
    return report;
  }

  listSavedReports(ledgerId: string): SavedReport[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM saved_report WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(ledgerId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      name: str(row['name']),
      spec: JSON.parse(str(row['spec'])) as unknown,
      createdBy: str(row['created_by']),
      createdAt: str(row['created_at']),
    }));
  }

  getSavedReport(id: string): SavedReport | null {
    const row = this.#db
      .prepare(`SELECT * FROM saved_report WHERE id = ? AND deleted_at IS NULL`)
      .get(id) as Row | undefined;
    if (row === undefined) return null;
    return {
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      name: str(row['name']),
      spec: JSON.parse(str(row['spec'])) as unknown,
      createdBy: str(row['created_by']),
      createdAt: str(row['created_at']),
    };
  }

  // -------------------------------------------------------------------------
  // MCP access log (FR-OPN-07)
  // -------------------------------------------------------------------------

  /**
   * Records one tool call made by an outside AI. Written before the result is
   * returned, so a read that happened is logged even if the response is never
   * delivered — the user's question is "what left my ledger", not "what
   * arrived somewhere".
   */
  recordMcpAccess(entry: {
    ledgerId: string;
    client: string;
    tool: string;
    scope: 'read' | 'write';
    summary: string;
    rowCount?: number;
  }): McpAccessEntry {
    const record: McpAccessEntry = {
      id: randomUUID(),
      ledgerId: entry.ledgerId,
      client: entry.client,
      tool: entry.tool,
      scope: entry.scope,
      summary: entry.summary,
      rowCount: entry.rowCount ?? 0,
      at: this.#now(),
    };
    this.#db
      .prepare(
        `INSERT INTO mcp_access_log (id, ledger_id, client, tool, scope, summary, row_count, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id, record.ledgerId, record.client, record.tool,
        record.scope, record.summary, record.rowCount, record.at,
      );
    return record;
  }

  listMcpAccess(ledgerId: string, limit = 50): McpAccessEntry[] {
    const rows = this.#db
      // rowid breaks ties: several calls can share a timestamp, and "most
      // recent first" has to hold anyway.
      .prepare(`SELECT * FROM mcp_access_log WHERE ledger_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(ledgerId, limit) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      client: str(row['client']),
      tool: str(row['tool']),
      scope: str(row['scope']) as 'read' | 'write',
      summary: str(row['summary']),
      rowCount: num(row['row_count']),
      at: str(row['at']),
    }));
  }

  // -------------------------------------------------------------------------
  // Category rules (FR-LED-10)
  // -------------------------------------------------------------------------

  listRules(ledgerId: string): CategoryRule[] {
    const rows = this.#db
      .prepare(`SELECT * FROM category_rule WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY priority DESC`)
      .all(ledgerId) as Row[];
    return rows.map((row) => ({
      id: str(row['id']),
      ledgerId: str(row['ledger_id']),
      matchType: str(row['match_type']) as CategoryRule['matchType'],
      pattern: str(row['pattern']),
      categoryId: str(row['category_id']),
      priority: num(row['priority']),
      createdAt: str(row['created_at']),
      deletedAt: nullableStr(row['deleted_at']),
    }));
  }

  /**
   * A correction becomes a rule, so the same merchant never needs the model
   * again. Re-correcting the same merchant replaces the rule rather than
   * stacking a second one.
   */
  learnRule(input: {
    ledgerId: string;
    matchType: CategoryRule['matchType'];
    pattern: string;
    categoryId: string;
    priority?: number;
  }): CategoryRule {
    this.#db
      .prepare(
        `UPDATE category_rule SET deleted_at = ?
         WHERE ledger_id = ? AND match_type = ? AND lower(pattern) = lower(?) AND deleted_at IS NULL`,
      )
      .run(this.#now(), input.ledgerId, input.matchType, input.pattern);

    const rule: CategoryRule = {
      id: randomUUID(),
      ledgerId: input.ledgerId,
      matchType: input.matchType,
      pattern: input.pattern,
      categoryId: input.categoryId,
      priority: input.priority ?? (input.matchType === 'merchant_exact' ? 100 : 50),
      createdAt: this.#now(),
      deletedAt: null,
    };
    this.#db
      .prepare(
        `INSERT INTO category_rule (id, ledger_id, match_type, pattern, category_id, priority, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(rule.id, rule.ledgerId, rule.matchType, rule.pattern, rule.categoryId, rule.priority, rule.createdAt);
    return rule;
  }

  /**
   * The local fast path (NFR-P-01). A hit here means no model call at all,
   * which is where the sub-50ms and most of the cost saving come from.
   */
  applyRules(ledgerId: string, input: { merchantName?: string | null; note?: string | null }): string | null {
    const merchant = (input.merchantName ?? '').toLowerCase();
    const note = (input.note ?? '').toLowerCase();

    for (const rule of this.listRules(ledgerId)) {
      const pattern = rule.pattern.toLowerCase();
      const hit =
        rule.matchType === 'merchant_exact'
          ? merchant === pattern
          : rule.matchType === 'merchant_contains'
            ? merchant.length > 0 && merchant.includes(pattern)
            : note.length > 0 && note.includes(pattern);
      if (hit) return rule.categoryId;
    }
    return null;
  }
}
