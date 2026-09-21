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
  { id: 'subscription_audit', label: 'Subscriptions' },
  { id: 'large_anomalies', label: 'Unusual' },
  { id: 'tax_pack', label: 'Tax pack' },
] as const;

interface McpEntry {
  id: string;
  client: string;
  tool: string;
  scope: 'read' | 'write';
  summary: string;
  at: string;
}

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
  const [mcpAccess, setMcpAccess] = useState<McpEntry[]>([]);
  const [skill, setSkill] = useState<{ slug: string; files: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const load = useCallback(
    async (ledgerId: string, report: string) => {
      const [overview, categoryList, reportResult, recent, review, access] = await Promise.all([
        client.overview(ledgerId),
        client.categories(ledgerId),
        client.standardReport(ledgerId, report),
        client.transactions(ledgerId, { limit: 20 }),
        client.transactions(ledgerId, { status: 'pending_review', limit: 20 }),
        client.mcpAccess(ledgerId),
      ]);

      setLedger(overview.ledger);
      setAccountId(overview.accounts[0]?.id ?? '');
      setPendingCount(overview.pendingCount);
      setCategories(categoryList.categories);
      setFactSet(reportResult.factSet);
      setTransactions(recent.transactions);
      setPending(review.transactions);
      setMcpAccess(access.entries);
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
            <>
              <button
                onClick={() => {
                  void client
                    .skillBundle(ledger.id, reportId)
                    .then((result) => setSkill(result.bundle));
                }}
              >
                Export as Skill
              </button>
              <a className="linkish" href={client.exportUrl(ledger.id)}>
                Export CSV
              </a>
            </>
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
        <h2>
          What your AI has read <span className="count">{mcpAccess.length}</span>
        </h2>
        {mcpAccess.length === 0 ? (
          <p className="hint">
            Nothing yet. Connect Kiwi to your own Claude or ChatGPT and every read it makes shows
            up here — read-only unless you turn writing on.
          </p>
        ) : (
          <div className="rows">
            {mcpAccess.map((entry) => (
              <div className="row" key={entry.id} style={{ cursor: 'default' }}>
                <span className="row-date">{entry.at.slice(5, 16).replace('T', ' ')}</span>
                <span className="row-main">
                  <span className="row-title">
                    {entry.client} {entry.summary}
                  </span>
                  <span className="row-meta">{entry.tool}</span>
                </span>
                <span className={`chip ${entry.scope === 'write' ? 'review' : 'foreign'}`}>
                  {entry.scope}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

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

      {skill !== null && (
        <div className="drawer-backdrop" onClick={() => setSkill(null)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSkill(null)}>
              Close
            </button>
            <h3>{skill.slug}</h3>
            <p className="sub">
              Drop this folder into your own agent’s skills directory. It carries the spec, not
              your figures.
            </p>
            {Object.entries(skill.files).map(([path, contents]) => (
              <div key={path}>
                <h2 style={{ marginTop: 20 }}>{path}</h2>
                <pre
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    padding: 14,
                    overflowX: 'auto',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {contents}
                </pre>
              </div>
            ))}
          </div>
        </div>
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
