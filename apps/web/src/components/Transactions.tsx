/**
 * Transaction rows and the trace drawer.
 *
 * A foreign-currency row shows what was actually paid alongside the base
 * amount, because "¥30,000 · S$270.00" is the truth and either half alone is
 * not. The drawer is FR-ANA-05 and FR-CAP-09 made visible: the frozen rate,
 * its source, and the original artefact the row came from.
 */

import { formatMoneyMinor, type KiwiClient } from '@kiwi/client';
import type { Transaction } from '@kiwi/ledger';
import { useEffect, useState } from 'react';

export function TransactionRows({
  transactions,
  categories,
  onOpen,
}: {
  transactions: readonly Transaction[];
  categories: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  if (transactions.length === 0) return <p className="empty">Nothing here yet.</p>;

  return (
    <div className="rows">
      {transactions.map((txn) => {
        const foreign = txn.currency !== txn.baseCurrency;
        return (
          <button className="row" key={txn.id} onClick={() => onOpen(txn.id)}>
            <span className="row-date">{txn.date.slice(5)}</span>
            <span className="row-main">
              <span className="row-title">
                {txn.merchantName ?? txn.note ?? 'Untitled'}{' '}
                {txn.status === 'pending_review' && <span className="chip review">review</span>}{' '}
                {foreign && <span className="chip foreign">{txn.currency}</span>}
              </span>
              <span className="row-meta">
                {txn.categoryId === null
                  ? 'Uncategorised'
                  : (categories.get(txn.categoryId) ?? 'Uncategorised')}
                {txn.kind !== 'expense' && txn.kind !== 'income' && ` · ${txn.kind}`}
              </span>
            </span>
            <span className={`row-amount${txn.amountMinor > 0 ? ' income' : ''}`}>
              {foreign ? (
                <>
                  {formatMoneyMinor(txn.amountMinor, txn.currency)}
                  <br />
                  <span className="row-meta">
                    {formatMoneyMinor(txn.baseAmountMinor, txn.baseCurrency)}
                  </span>
                </>
              ) : (
                formatMoneyMinor(txn.amountMinor, txn.currency)
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface TraceState {
  transaction: Transaction;
  provenance: { kind: string; ref: string; extractedBy: string | null; capturedAt: string } | null;
}

export function TraceDrawer({
  client,
  transactionId,
  categories,
  onClose,
  onChanged,
}: {
  client: KiwiClient;
  transactionId: string;
  categories: Map<string, string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<TraceState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client.trace(transactionId).then((result) => {
      if (!cancelled) setState(result as unknown as TraceState);
    });
    return () => {
      cancelled = true;
    };
  }, [client, transactionId]);

  async function confirm() {
    setBusy(true);
    await client.updateTransaction(transactionId, { status: 'confirmed' });
    onChanged();
    onClose();
  }

  async function remove() {
    setBusy(true);
    await client.deleteTransaction(transactionId);
    onChanged();
    onClose();
  }

  const txn = state?.transaction;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          Close
        </button>

        {txn === undefined ? (
          <p className="spinner">Loading…</p>
        ) : (
          <>
            <h3>{txn.merchantName ?? txn.note ?? 'Untitled'}</h3>
            <p className="sub">
              {txn.date} ·{' '}
              {txn.categoryId === null
                ? 'Uncategorised'
                : (categories.get(txn.categoryId) ?? 'Uncategorised')}
            </p>

            <dl className="kv">
              <dt>Amount paid</dt>
              <dd>{formatMoneyMinor(txn.amountMinor, txn.currency)}</dd>

              {txn.currency !== txn.baseCurrency && (
                <>
                  <dt>In {txn.baseCurrency}</dt>
                  <dd>{formatMoneyMinor(txn.baseAmountMinor, txn.baseCurrency)}</dd>
                  <dt>Rate used</dt>
                  <dd>
                    {txn.fxRate} · {txn.fxRateSource.replace('_', ' ')}
                  </dd>
                  <dt>Rate date</dt>
                  <dd>{txn.fxAsOf}</dd>
                </>
              )}

              <dt>Kind</dt>
              <dd>{txn.kind}</dd>
              <dt>Captured by</dt>
              <dd>{txn.source}</dd>
              {txn.aiConfidence !== null && (
                <>
                  <dt>Confidence</dt>
                  <dd>{Math.round(txn.aiConfidence * 100)}%</dd>
                </>
              )}
              <dt>Status</dt>
              <dd>{txn.status}</dd>
            </dl>

            {txn.currency !== txn.baseCurrency && (
              <p className="note">
                The rate was frozen when this was recorded, so this figure will read the same in a
                year even after the market moves.
              </p>
            )}

            {state?.provenance !== null && state?.provenance !== undefined && (
              <p className="note">
                Came from a {state.provenance.kind}:{' '}
                <span className="mono">{state.provenance.ref}</span>
                {state.provenance.extractedBy !== null && (
                  <>
                    , read by <span className="mono">{state.provenance.extractedBy}</span>
                  </>
                )}
                .
              </p>
            )}

            <div className="toolbar" style={{ borderBottom: 0 }}>
              {txn.status === 'pending_review' && (
                <button className="primary" onClick={() => void confirm()} disabled={busy}>
                  Confirm
                </button>
              )}
              <button onClick={() => void remove()} disabled={busy}>
                Delete
              </button>
              <span className="hint">Deleting hides the row; it stays recoverable.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SourceDrawer({
  client,
  label,
  ids,
  categories,
  onClose,
  onOpenTransaction,
}: {
  client: KiwiClient;
  label: string;
  ids: readonly string[];
  categories: Map<string, string>;
  onClose: () => void;
  onOpenTransaction: (id: string) => void;
}) {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client.lookup([...ids]).then((result) => {
      if (!cancelled) {
        setTransactions(
          [...result.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, ids]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          Close
        </button>
        <h3>{label}</h3>
        <p className="sub">
          Every transaction behind this figure — {ids.length}{' '}
          {ids.length === 1 ? 'row' : 'rows'}.
        </p>
        {transactions === null ? (
          <p className="spinner">Loading…</p>
        ) : (
          <TransactionRows
            transactions={transactions}
            categories={categories}
            onOpen={onOpenTransaction}
          />
        )}
      </div>
    </div>
  );
}
