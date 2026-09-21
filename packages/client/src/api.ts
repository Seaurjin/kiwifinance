/**
 * The API client.
 *
 * One implementation for both apps. It uses global fetch, which React Native
 * and every browser provide, and keeps no framework dependency so it can be
 * imported from a React component, a widget extension's bridge, or a script.
 */

import type { Account, Budget, Category, Ledger, Transaction } from '@kiwi/ledger';
import type { MetricDefinition } from '@kiwi/metrics';
import type { FactSet, ReportSpec } from '@kiwi/report-spec';

export interface ApiErrorBody {
  error: string;
  message?: string;
  violations?: { path: string; message: string }[];
  existingId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message ?? body.error);
    this.name = 'ApiError';
  }

  /** True when a report spec was rejected, which is a retryable authoring problem. */
  get isSpecInvalid(): boolean {
    return this.body.error === 'spec_invalid';
  }
}

export interface Draft {
  amountMinor: number;
  currency: string;
  date: string;
  merchantName: string | null;
  categorySlug: string | null;
  note: string | null;
  confidence: number;
}

export interface LedgerOverview {
  ledger: Ledger;
  accounts: Account[];
  budgets: Budget[];
  pendingCount: number;
}

export type MetricCatalogueEntry = Pick<
  MetricDefinition,
  'id' | 'label' | 'unit' | 'returns' | 'description'
>;

export class KiwiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
    this.#baseUrl = baseUrl;
    // A browser's fetch must be called with the global as its receiver; held
    // as a bare field it throws "Illegal invocation" the first time it runs.
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

    if (!response.ok) {
      let body: ApiErrorBody = { error: `http_${response.status}` };
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // A non-JSON error body is still an error; the status carries the meaning.
      }
      throw new ApiError(response.status, body);
    }

    return (await response.json()) as T;
  }

  health(): Promise<{ ok: boolean; today: string }> {
    return this.#request('/health');
  }

  listLedgers(): Promise<{ ledgers: Ledger[] }> {
    return this.#request('/api/ledgers');
  }

  overview(ledgerId: string): Promise<LedgerOverview> {
    return this.#request(`/api/ledgers/${ledgerId}`);
  }

  categories(ledgerId: string): Promise<{ categories: Category[] }> {
    return this.#request(`/api/ledgers/${ledgerId}/categories`);
  }

  transactions(
    ledgerId: string,
    query: { from?: string; to?: string; status?: string; limit?: number } = {},
  ): Promise<{ transactions: Transaction[] }> {
    const search = new URLSearchParams(
      Object.entries(query).flatMap<[string, string]>(([key, value]) =>
        value === undefined ? [] : [[key, String(value)]],
      ),
    );
    const suffix = search.toString().length > 0 ? `?${search}` : '';
    return this.#request(`/api/ledgers/${ledgerId}/transactions${suffix}`);
  }

  createTransaction(
    ledgerId: string,
    body: Record<string, unknown>,
  ): Promise<{ transaction: Transaction }> {
    return this.#request(`/api/ledgers/${ledgerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  updateTransaction(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ transaction: Transaction }> {
    return this.#request(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteTransaction(id: string): Promise<{ ok: boolean; recoverable: boolean }> {
    return this.#request(`/api/transactions/${id}`, { method: 'DELETE' });
  }

  trace(id: string): Promise<{ transaction: Transaction; provenance: unknown }> {
    return this.#request(`/api/transactions/${id}/trace`);
  }

  lookup(ids: string[]): Promise<{ transactions: Transaction[] }> {
    return this.#request('/api/transactions/lookup', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  metrics(): Promise<{ metrics: MetricCatalogueEntry[] }> {
    return this.#request('/api/metrics');
  }

  reports(): Promise<{
    standard: { id: string; title: string; description: string }[];
    pending: { id: string; title: string; needs: string[] }[];
  }> {
    return this.#request('/api/reports');
  }

  standardReport(
    ledgerId: string,
    reportId: string,
    window?: { from: string; to: string },
  ): Promise<{ report: { id: string; title: string }; spec: ReportSpec; factSet: FactSet }> {
    const suffix = window === undefined ? '' : `?from=${window.from}&to=${window.to}`;
    return this.#request(`/api/ledgers/${ledgerId}/reports/${reportId}${suffix}`);
  }

  runSpec(ledgerId: string, spec: unknown): Promise<{ factSet: FactSet }> {
    return this.#request(`/api/ledgers/${ledgerId}/reports/run`, {
      method: 'POST',
      body: JSON.stringify(spec),
    });
  }

  extract(ledgerId: string, text: string): Promise<{ drafts: Draft[]; extractedBy: string }> {
    return this.#request(`/api/ledgers/${ledgerId}/capture/extract`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  commit(
    ledgerId: string,
    body: { accountId: string; source?: string; extractedBy?: string; drafts: Partial<Draft>[] },
  ): Promise<{ transactions: Transaction[] }> {
    return this.#request(`/api/ledgers/${ledgerId}/capture/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  skillBundle(
    ledgerId: string,
    reportId: string,
  ): Promise<{ bundle: { slug: string; files: Record<string, string> } }> {
    return this.#request(`/api/ledgers/${ledgerId}/reports/${reportId}/skill`);
  }

  mcpAccess(ledgerId: string): Promise<{
    entries: {
      id: string;
      client: string;
      tool: string;
      scope: 'read' | 'write';
      summary: string;
      rowCount: number;
      at: string;
    }[];
  }> {
    return this.#request(`/api/ledgers/${ledgerId}/mcp-access`);
  }

  exportUrl(ledgerId: string): string {
    return `${this.#baseUrl}/api/ledgers/${ledgerId}/export.csv`;
  }
}
