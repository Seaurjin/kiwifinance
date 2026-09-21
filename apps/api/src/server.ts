/**
 * The API.
 *
 * It is a thin layer: routes resolve a ledger, hand work to the store or the
 * metric engine, and translate domain errors into status codes. No figure is
 * computed here, and no route may assemble one — anything numeric comes back
 * from @kiwi/metrics through a report spec.
 */

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { minorUnitsPerMajor, period as makePeriod, monthOf, type IsoDate } from '@kiwi/core';
import { LedgerInvariantError, type Transaction } from '@kiwi/ledger';
import { defaultRegistry } from '@kiwi/metrics';
import {
  DEFAULT_ROUTING,
  ModelRouter,
  createStubExtractor,
  type Region,
} from '@kiwi/model-router';
import {
  SpecValidationError,
  STANDARD_REPORTS,
  PENDING_REPORTS,
  executeSpec,
  exportReportAsSkill,
  parseSpec,
  standardReport,
  validateSpec,
} from '@kiwi/report-spec';
import { DuplicateCaptureError, LedgerStore, type NewTransaction } from '@kiwi/store';

export interface ServerOptions {
  readonly store: LedgerStore;
  /** Injected so tests and the demo are reproducible. */
  readonly today: () => IsoDate;
  readonly region?: Region;
}

interface LedgerParams {
  ledgerId: string;
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const { store } = options;

  app.register(cors, { origin: true });

  // Domain errors carry the status they deserve; everything else is a 500.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SpecValidationError) {
      return reply.status(422).send({ error: 'spec_invalid', violations: error.violations });
    }
    if (error instanceof DuplicateCaptureError) {
      return reply.status(409).send({ error: 'duplicate_capture', existingId: error.existingId });
    }
    if (error instanceof LedgerInvariantError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : String(error);
    if (statusCode !== undefined && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'internal', message });
  });

  function requireLedger(ledgerId: string) {
    const ledger = store.getLedger(ledgerId);
    if (ledger === null) {
      const error = new Error(`No ledger ${ledgerId}.`) as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return ledger;
  }

  function periodFromQuery(query: Record<string, unknown>): { from: IsoDate; to: IsoDate } {
    const from = typeof query['from'] === 'string' ? query['from'] : undefined;
    const to = typeof query['to'] === 'string' ? query['to'] : undefined;
    if (from !== undefined && to !== undefined) return makePeriod(from, to);
    return monthOf(options.today());
  }

  // -------------------------------------------------------------------------

  app.get('/health', async () => ({ ok: true, today: options.today() }));

  app.get('/api/ledgers', async () => ({ ledgers: store.listLedgers() }));

  app.get<{ Params: LedgerParams }>('/api/ledgers/:ledgerId', async (request) => {
    const ledger = requireLedger(request.params.ledgerId);
    return {
      ledger,
      accounts: store.listAccounts(ledger.id),
      budgets: store.listBudgets(ledger.id),
      pendingCount: store.listTransactions(ledger.id, { status: 'pending_review', limit: 500 }).length,
    };
  });

  app.get<{ Params: LedgerParams }>('/api/ledgers/:ledgerId/categories', async (request) => {
    requireLedger(request.params.ledgerId);
    return { categories: store.listCategories(request.params.ledgerId) };
  });

  app.get<{ Params: LedgerParams; Querystring: Record<string, string> }>(
    '/api/ledgers/:ledgerId/transactions',
    async (request) => {
      requireLedger(request.params.ledgerId);
      const { from, to, status, limit } = request.query;
      return {
        transactions: store.listTransactions(request.params.ledgerId, {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          ...(status === 'pending_review' || status === 'confirmed' ? { status } : {}),
          limit: limit !== undefined ? Number(limit) : 200,
        }),
      };
    },
  );

  app.post<{ Params: LedgerParams; Body: Omit<NewTransaction, 'ledgerId'> }>(
    '/api/ledgers/:ledgerId/transactions',
    async (request, reply) => {
      requireLedger(request.params.ledgerId);
      const body = request.body;

      // A rule hit is the fast path: no model, no cost, no latency.
      const categoryId =
        body.categoryId ??
        store.applyRules(request.params.ledgerId, {
          merchantName: body.merchantName ?? null,
          note: body.note ?? null,
        });

      const created = store.createTransaction({
        ...body,
        ledgerId: request.params.ledgerId,
        categoryId,
      });
      return reply.status(201).send({ transaction: created });
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<Transaction> }>(
    '/api/transactions/:id',
    async (request) => {
      const current = store.getTransaction(request.params.id);
      if (current === null) {
        const error = new Error('No such transaction.') as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      }

      const patch = request.body;
      const updated = store.updateTransaction(request.params.id, patch);

      // A correction is worth more than the one row it fixes: it becomes the
      // rule that keeps the same merchant off the model next time (FR-LED-10).
      if (
        patch.categoryId != null &&
        patch.categoryId !== current.categoryId &&
        updated.merchantName !== null
      ) {
        store.learnRule({
          ledgerId: updated.ledgerId,
          matchType: 'merchant_exact',
          pattern: updated.merchantName,
          categoryId: patch.categoryId,
        });
      }

      return { transaction: updated };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/transactions/:id', async (request) => {
    store.softDeleteTransaction(request.params.id);
    return { ok: true, recoverable: true };
  });

  app.post<{ Params: { id: string } }>('/api/transactions/:id/restore', async (request) => {
    store.restoreTransaction(request.params.id);
    return { ok: true };
  });

  /** Everything behind one figure (FR-ANA-05, FR-CAP-09). */
  app.get<{ Params: { id: string } }>('/api/transactions/:id/trace', async (request) => {
    const transaction = store.getTransaction(request.params.id);
    if (transaction === null) {
      const error = new Error('No such transaction.') as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return {
      transaction,
      provenance:
        transaction.provenanceId === null ? null : store.getProvenance(transaction.provenanceId),
    };
  });

  app.post<{ Body: { ids: string[] } }>('/api/transactions/lookup', async (request) => ({
    transactions: store.getTransactions(request.body.ids ?? []),
  }));

  // -------------------------------------------------------------------------
  // Metrics and reports
  // -------------------------------------------------------------------------

  app.get('/api/metrics', async () => ({ metrics: defaultRegistry.catalogue() }));

  app.get('/api/reports', async () => ({
    standard: STANDARD_REPORTS.map(({ id, title, description }) => ({ id, title, description })),
    pending: PENDING_REPORTS,
  }));

  app.post<{ Params: LedgerParams; Body: unknown }>(
    '/api/ledgers/:ledgerId/reports/run',
    async (request) => {
      requireLedger(request.params.ledgerId);
      const factSet = executeSpec(request.body, {
        snapshot: store.loadSnapshot(request.params.ledgerId),
        today: options.today(),
      });
      return { factSet };
    },
  );

  app.post<{ Params: LedgerParams; Body: unknown }>(
    '/api/ledgers/:ledgerId/reports/validate',
    async (request) => ({ violations: validateSpec(request.body) }),
  );

  app.get<{ Params: LedgerParams & { reportId: string }; Querystring: Record<string, string> }>(
    '/api/ledgers/:ledgerId/reports/:reportId',
    async (request, reply) => {
      const ledger = requireLedger(request.params.ledgerId);
      const report = standardReport(request.params.reportId);
      if (report === undefined) {
        return reply.status(404).send({
          error: 'unknown_report',
          available: STANDARD_REPORTS.map((r) => r.id),
          pending: PENDING_REPORTS,
        });
      }

      const window = periodFromQuery(request.query);
      const spec = report.build(window, ledger.baseCurrency);
      const factSet = executeSpec(spec, {
        snapshot: store.loadSnapshot(ledger.id),
        today: options.today(),
      });
      return { report: { id: report.id, title: report.title }, spec, factSet };
    },
  );

  /**
   * A report packaged as an Agent Skill (FR-OPN-02/03). Returns the file map
   * rather than an archive, so the client can show it before saving it.
   */
  app.get<{ Params: LedgerParams & { reportId: string } }>(
    '/api/ledgers/:ledgerId/reports/:reportId/skill',
    async (request, reply) => {
      const ledger = requireLedger(request.params.ledgerId);
      const report = standardReport(request.params.reportId);
      const saved = report === undefined ? store.getSavedReport(request.params.reportId) : null;

      if (report === undefined && saved === null) {
        return reply.status(404).send({ error: 'unknown_report' });
      }

      const name = report?.title ?? saved?.name ?? 'Report';
      const spec =
        report === undefined
          ? parseSpec(saved?.spec)
          : report.build(monthOf(options.today()), ledger.baseCurrency);

      return {
        bundle: exportReportAsSkill(name, spec, { ledgerName: ledger.name }),
      };
    },
  );

  /** Reports the user, or their own AI over MCP, has saved (FR-ANA-08). */
  app.get<{ Params: LedgerParams }>('/api/ledgers/:ledgerId/saved-reports', async (request) => {
    requireLedger(request.params.ledgerId);
    return { reports: store.listSavedReports(request.params.ledgerId) };
  });

  app.post<{ Params: LedgerParams; Body: { name: string; spec: unknown } }>(
    '/api/ledgers/:ledgerId/saved-reports',
    async (request, reply) => {
      requireLedger(request.params.ledgerId);
      const spec = parseSpec(request.body.spec);
      const saved = store.saveReport({
        ledgerId: request.params.ledgerId,
        name: request.body.name,
        spec,
        createdBy: 'user',
      });
      return reply.status(201).send({ report: saved });
    },
  );

  /**
   * What an outside AI has read, in the owner's words (FR-OPN-07).
   * This is the page that makes an MCP connection something a person can
   * supervise rather than something they have to trust.
   */
  app.get<{ Params: LedgerParams }>('/api/ledgers/:ledgerId/mcp-access', async (request) => {
    requireLedger(request.params.ledgerId);
    return { entries: store.listMcpAccess(request.params.ledgerId, 50) };
  });

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------

  /**
   * Extraction. Returns drafts for review; nothing is written here.
   * Low confidence is not an error — it is what the confirmation queue is for.
   */
  app.post<{ Params: LedgerParams; Body: { text?: string } }>(
    '/api/ledgers/:ledgerId/capture/extract',
    async (request) => {
      const ledger = requireLedger(request.params.ledgerId);
      const extractor = createStubExtractor({
        baseCurrency: ledger.baseCurrency,
        today: options.today(),
      });
      const captureRouter = new ModelRouter(
        {
          ...DEFAULT_ROUTING,
          global: { ...DEFAULT_ROUTING.global, extract: { provider: 'stub', model: 'stub-parser' } },
          cn: { ...DEFAULT_ROUTING.cn, extract: { provider: 'stub', model: 'stub-parser' } },
        },
        [extractor],
      );

      const result = await captureRouter.run<{ drafts: unknown[] }>({
        task: 'extract',
        region: options.region ?? 'global',
        input: { text: request.body.text ?? '' },
      });

      return {
        drafts: result.output.drafts,
        extractedBy: `${result.provider}/${result.model}`,
        costUsd: result.costUsd,
      };
    },
  );

  /** Commit reviewed drafts. Each becomes a row with its provenance attached. */
  app.post<{
    Params: LedgerParams;
    Body: {
      accountId: string;
      source?: NewTransaction['source'];
      provenanceRef?: string;
      extractedBy?: string;
      drafts: {
        amountMinor: number;
        currency: string;
        date: string;
        merchantName?: string | null;
        categorySlug?: string | null;
        note?: string | null;
        confidence?: number;
        fxRate?: number;
      }[];
    };
  }>('/api/ledgers/:ledgerId/capture/commit', async (request, reply) => {
    const ledger = requireLedger(request.params.ledgerId);
    const body = request.body;
    const source = body.source ?? 'voice';

    const provenanceId =
      source === 'manual'
        ? null
        : store.createProvenance({
            ledgerId: ledger.id,
            kind: source === 'voice' ? 'voice' : source === 'photo' ? 'photo' : 'screenshot',
            ref: body.provenanceRef ?? 'in-app capture',
            extractedBy: body.extractedBy ?? null,
          }).id;

    const created = body.drafts.map((draft) => {
      const categoryId =
        draft.categorySlug != null
          ? `${ledger.id}:${draft.categorySlug}`
          : store.applyRules(ledger.id, {
              merchantName: draft.merchantName ?? null,
              note: draft.note ?? null,
            });

      const confidence = draft.confidence ?? null;
      return store.createTransaction({
        ledgerId: ledger.id,
        accountId: body.accountId,
        kind: draft.amountMinor > 0 ? 'income' : 'expense',
        date: draft.date,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        ...(draft.fxRate !== undefined ? { fxRate: draft.fxRate } : {}),
        categoryId,
        merchantName: draft.merchantName ?? null,
        note: draft.note ?? null,
        source,
        aiConfidence: confidence,
        provenanceId,
        // Anything the extractor was not sure about waits for a human.
        status: confidence !== null && confidence < 0.8 ? 'pending_review' : 'confirmed',
      });
    });

    return reply.status(201).send({ transactions: created });
  });

  // -------------------------------------------------------------------------
  // Export — no paywall, ever (FR-OPN-01, P-3)
  // -------------------------------------------------------------------------

  app.get<{ Params: LedgerParams }>('/api/ledgers/:ledgerId/export.csv', async (request, reply) => {
    requireLedger(request.params.ledgerId);
    const rows = store.listTransactions(request.params.ledgerId, { limit: 100_000 });
    const header = [
      'id', 'date', 'kind', 'amount', 'currency', 'fx_rate', 'fx_rate_source', 'fx_as_of',
      'base_amount', 'base_currency', 'category_id', 'merchant', 'note', 'tags', 'source', 'status',
    ];
    const body = rows.map((txn) =>
      [
        txn.id,
        txn.date,
        txn.kind,
        // Major units, so the file opens correctly in a spreadsheet.
        (txn.amountMinor / minorUnitsPerMajor(txn.currency)).toFixed(
          String(minorUnitsPerMajor(txn.currency)).length - 1,
        ),
        txn.currency,
        txn.fxRate,
        txn.fxRateSource,
        txn.fxAsOf,
        (txn.baseAmountMinor / minorUnitsPerMajor(txn.baseCurrency)).toFixed(2),
        txn.baseCurrency,
        txn.categoryId,
        txn.merchantName,
        txn.note,
        txn.tags.join('|'),
        txn.source,
        txn.status,
      ]
        .map(csvCell)
        .join(','),
    );

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="kiwi-export.csv"')
      .send([header.join(','), ...body].join('\n'));
  });

  return app;
}
