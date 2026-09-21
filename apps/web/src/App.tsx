/**
 * Kiwi web.
 *
 * The page shows a report, not a hand-assembled dashboard: it asks the API for
 * a standard report's fact set and renders the blocks it gets back. That means
 * the built-in view and a report the user writes themselves go down the same
 * path, and no figure on screen was computed by this app.
 */

import { KiwiClient, formatPeriod, isScalar, isSeries } from '@kiwi/client';
import type { FactSet } from '@kiwi/report-spec';
import type { Category, Ledger, Transaction } from '@kiwi/ledger';
import type { ScalarFact, SeriesFact } from '@kiwi/metrics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarSeries, KpiRow, SeriesTable } from './components/Facts.tsx';
import { CaptureBar } from './components/Capture.tsx';
import { SourceDrawer, TraceDrawer, TransactionRows } from './components/Transactions.tsx';

const client = new KiwiClient(import.meta.env['VITE_API_URL'] ?? '');

const REPORT_TABS = [
  { id: 'monthly_review', label: 'This month' },
  { id: 'fx_exposure', label: 'FX exposure' },
  { id: 'budget_replan', label: 'Budget' },
] as const;

type Drill = { label: string; ids: readonly string[] };

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [pendingCount, setPendingCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reportId, setReportId] = useState<string>('monthly_review');
  const [factSet, setFactSet] = useState<FactSet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pending, setPending] = useState<Transaction[]>([]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [openTxn, setOpenTxn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const load = useCallback(
    async (ledgerId: string, report: string) => {
      const [overview, categoryList, reportResult, recent, review] = await Promise.all([
        client.overview(ledgerId),
        client.categories(ledgerId),
        client.standardReport(ledgerId, report),
        client.transactions(ledgerId, { limit: 20 }),
        client.transactions(ledgerId, { status: 'pending_review', limit: 20 }),
      ]);

      setLedger(overview.ledger);
      setAccountId(overview.accounts[0]?.id ?? '');
      setPendingCount(overview.pendingCount);
      setCategories(categoryList.categories);
      setFactSet(reportResult.factSet);
      setTransactions(recent.transactions);
      setPending(review.transactions);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (ledger === null) return;
    await load(ledger.id, reportId);
  }, [ledger, reportId, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { ledgers } = await client.listLedgers();
        const first = ledgers[0];
        if (first === undefined) {
          setError('No ledger yet. Start the API with `pnpm --filter @kiwi/api dev`.');
          return;
        }
        if (!cancelled) await load(first.id, reportId);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `${cause.message} — is the API running on :8787?`
              : String(cause),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Report changes are handled by the tab handler so the whole page does not
    // remount when only one block needs refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchReport(next: string) {
    setReportId(next);
    if (ledger !== null) await load(ledger.id, next);
  }

  if (loading) return <div className="app"><p className="spinner">Loading…</p></div>;

  if (error !== null) {
    return (
      <div className="app">
        <header className="masthead">
          <div className="eyebrow">Kiwi Finance</div>
          <h1>Can’t reach the ledger</h1>
        </header>
        <p className="note error">{error}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="eyebrow">Kiwi Finance</div>
        <h1>{factSet?.specTitle ?? 'Ledger'}</h1>
        <p className="sub">
          {ledger?.name} ·{' '}
          {factSet !== null &&
            formatPeriod(factSet.basis.period.from, factSet.basis.period.to)}{' '}
          · figures in {factSet?.basis.baseCurrency} at the{' '}
          {factSet?.basis.fxMode === 'transaction' ? 'rate actually paid' : 'reporting rate'}
        </p>

        <nav className="toolbar">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              aria-pressed={reportId === tab.id}
              onClick={() => void switchReport(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {ledger !== null && (
            <a className="linkish" href={client.exportUrl(ledger.id)}>
              Export CSV
            </a>
          )}
        </nav>
      </header>

      {factSet?.blocks.map((block) => {
        const scalars = block.facts.filter(isScalar);
        const seriesFacts = block.facts.filter(isSeries);
        const comparison = block.comparisonFacts?.filter(isScalar);

        if (block.type === 'metric_row' && scalars.length > 0) {
          return (
            <section key={block.id}>
              <h2>{block.title ?? 'Headline'}</h2>
              <KpiRow
                facts={scalars as ScalarFact[]}
                comparison={comparison as ScalarFact[] | undefined}
                onDrill={(fact) => setDrill({ label: fact.label, ids: fact.sourceTxnIds })}
              />
            </section>
          );
        }

        if (block.type === 'chart' && seriesFacts[0] !== undefined) {
          return (
            <section key={block.id}>
              <h2>{block.title ?? seriesFacts[0].label}</h2>
              <BarSeries
                fact={seriesFacts[0] as SeriesFact}
                onDrill={(fact) => setDrill({ label: fact.label, ids: fact.sourceTxnIds })}
              />
            </section>
          );
        }

        if (block.type === 'table' && seriesFacts[0] !== undefined) {
          return (
            <section key={block.id}>
              <h2>{block.title ?? seriesFacts[0].label}</h2>
              <SeriesTable
                fact={seriesFacts[0] as SeriesFact}
                onDrill={(fact) => setDrill({ label: fact.label, ids: fact.sourceTxnIds })}
              />
            </section>
          );
        }

        if (block.type === 'narrative') {
          return (
            <section key={block.id}>
              <h2>Reading</h2>
              <p className="note warn">
                A written reading of these figures goes here. It is not generated yet: the narrator
                runs a model, and every number it writes is checked against this fact set before
                you see it.
              </p>
            </section>
          );
        }

        return null;
      })}

      {ledger !== null && accountId !== '' && (
        <CaptureBar
          client={client}
          ledgerId={ledger.id}
          accountId={accountId}
          onCommitted={() => void refresh()}
        />
      )}

      {pending.length > 0 && (
        <section>
          <h2>
            Waiting for you <span className="count">{pendingCount}</span>
          </h2>
          <p className="hint">
            These were read with low confidence, so they are held out of every figure above until
            you confirm them.
          </p>
          <TransactionRows
            transactions={pending}
            categories={categoryNames}
            onOpen={setOpenTxn}
          />
        </section>
      )}

      <section>
        <h2>Recent</h2>
        <TransactionRows
          transactions={transactions}
          categories={categoryNames}
          onOpen={setOpenTxn}
        />
      </section>

      {drill !== null && (
        <SourceDrawer
          client={client}
          label={drill.label}
          ids={drill.ids}
          categories={categoryNames}
          onClose={() => setDrill(null)}
          onOpenTransaction={(id) => {
            setDrill(null);
            setOpenTxn(id);
          }}
        />
      )}

      {openTxn !== null && (
        <TraceDrawer
          client={client}
          transactionId={openTxn}
          categories={categoryNames}
          onClose={() => setOpenTxn(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
