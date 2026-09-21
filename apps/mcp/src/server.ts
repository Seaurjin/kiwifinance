/**
 * Wiring the tools into an MCP server.
 *
 * The tool descriptions are written for a model reading them cold, because
 * that is the only documentation it gets. Each says what the tool is for and,
 * where it matters, what to call first — an AI that starts with
 * `kiwi_list_schema` asks answerable questions; one that guesses at field
 * names does not.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LedgerStore } from '@kiwi/store';
import { z } from 'zod';
import { KiwiTools, ScopeDeniedError, type Session } from './tools.ts';

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date, YYYY-MM-DD.');

const windowFields = {
  from: dateField.optional().describe('Start of the period, inclusive. Defaults to this month.'),
  to: dateField.optional().describe('End of the period, inclusive. Defaults to this month.'),
};

/** Everything the tools return is JSON; the text block is for clients that only read text. */
function result(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

export function buildMcpServer(store: LedgerStore, session: Session): McpServer {
  const server = new McpServer(
    { name: 'kiwi-finance', version: '0.1.0' },
    {
      instructions:
        'This is one person\'s own financial ledger. Call kiwi_list_schema first: it lists the ' +
        'accounts, categories, currencies and the exact metrics available, so you can ask for ' +
        'figures that exist rather than guessing. Never compute a total yourself from rows you ' +
        'fetched — call kiwi_run_metric or kiwi_run_report, which return figures the ledger ' +
        'computed, each with the transactions behind it. Amounts are integers in the currency\'s ' +
        'minor unit; a JPY amount has no decimal part. Every call is recorded in a log the owner ' +
        'can read.',
    },
  );

  const tools = () => new KiwiTools(store, session);

  server.registerTool(
    'kiwi_list_schema',
    {
      title: 'List the ledger structure',
      description:
        'Accounts, the category tree, the currencies in use, the tags, every metric that can be ' +
        'computed and every report that can be run. Call this before anything else.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return result(tools().listSchema());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_query_transactions',
    {
      title: 'Query transactions',
      description:
        'Individual transactions in a period, optionally filtered by merchant or currency. ' +
        'Returns at most 200 rows and tells you when it capped. Use this to look at specific ' +
        'purchases — not to add them up.',
      inputSchema: {
        ...windowFields,
        merchant: z.string().max(200).optional().describe('Case-insensitive substring match.'),
        currency: z.string().length(3).optional().describe('ISO 4217 code, e.g. JPY.'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(tools().queryTransactions(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_run_metric',
    {
      title: 'Compute one figure',
      description:
        'Runs one named metric from the catalogue in kiwi_list_schema. The result carries its ' +
        'unit, its currency, the basis it was computed under, and the ids of the transactions ' +
        'behind it. An unknown metric name is rejected rather than approximated.',
      inputSchema: {
        metric: z.string().max(64).describe('An id from the catalogue, e.g. expense_total.'),
        ...windowFields,
        params: z.record(z.unknown()).optional().describe('Metric parameters, e.g. { "limit": 5 }.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(tools().runMetric(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_run_report',
    {
      title: 'Run a report',
      description:
        'Runs a standard report by id, or an ad-hoc report spec you supply. Returns a fact set: ' +
        'every figure with its unit, currency and source rows. Prefer this over fetching ' +
        'transactions and adding them up yourself.',
      inputSchema: {
        report: z.string().max(64).optional().describe('A report id from kiwi_list_schema.'),
        spec: z.unknown().optional().describe('A Report Spec, if you want something custom.'),
        ...windowFields,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(tools().runReport(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_search_receipts',
    {
      title: 'Find captured receipts',
      description:
        'Transactions that came from a photographed receipt, a screenshot or a forwarded email, ' +
        'with what kind of original each has and when it was captured.',
      inputSchema: {
        ...windowFields,
        merchant: z.string().max(200).optional(),
        minAmount: z
          .number()
          .int()
          .optional()
          .describe('Minor units of the base currency, e.g. 5000 for 50.00.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(tools().searchReceipts(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_add_transaction',
    {
      title: 'Record a transaction',
      description:
        'Adds one transaction. Needs the write scope, which is off unless the owner turned it ' +
        'on. Whatever you add waits in their confirmation queue and is excluded from every ' +
        'figure until they accept it.',
      inputSchema: {
        date: dateField,
        amountMinor: z
          .number()
          .int()
          .describe('Integer minor units. Negative for spending. JPY has no decimal part.'),
        currency: z.string().length(3),
        accountName: z.string().max(120).optional().describe('From kiwi_list_schema.'),
        merchant: z.string().max(200).optional(),
        categoryId: z.string().max(120).optional().describe('A category id from kiwi_list_schema.'),
        note: z.string().max(500).optional(),
        fxRate: z
          .number()
          .positive()
          .optional()
          .describe('Required when the currency is not the ledger base currency.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        return result(tools().addTransaction(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'kiwi_save_report',
    {
      title: 'Save a report',
      description:
        'Stores a report spec so the owner can re-run it. Needs the write scope. The spec is ' +
        'validated first, so a report that could never run is not saved.',
      inputSchema: {
        name: z.string().min(1).max(120),
        spec: z.unknown().describe('A Report Spec.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        return result(tools().saveReport(input as { name: string; spec: unknown }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

export { ScopeDeniedError };
