/**
 * Rendering facts.
 *
 * These components display what the engine computed and never compute
 * anything themselves — not a total, not a percentage, not a difference.
 * Every figure arrives as a Fact, with its unit, its currency and the ids of
 * the transactions behind it, and clicking one opens exactly those rows.
 */

import { compareFacts, formatFactValue, formatMoneyMinor, formatSeriesValue } from '@kiwi/client';
import type { ScalarFact, SeriesFact } from '@kiwi/metrics';

export interface FactClickHandler {
  (fact: { label: string; sourceTxnIds: readonly string[] }): void;
}

export function KpiRow({
  facts,
  comparison,
  onDrill,
}: {
  facts: readonly ScalarFact[];
  comparison?: readonly ScalarFact[] | undefined;
  onDrill: FactClickHandler;
}) {
  return (
    <div className="kpis">
      {facts.map((fact, index) => {
        const value = formatFactValue(fact);
        const previous = comparison?.[index];
        const change = compareFacts(fact, previous);

        return (
          <button
            key={fact.metric}
            className="kpi"
            onClick={() => onDrill(fact)}
            title={`${fact.sourceTxnIds.length} transactions — click to see them`}
          >
            <span className="kpi-label">{fact.label}</span>
            <span className={`kpi-value${value.available ? '' : ' unavailable'}`}>{value.text}</span>
            {change !== null && fact.unit === 'money' && (
              <span className="kpi-delta">
                {change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■'}{' '}
                {formatMoneyMinor(Math.abs(change.delta), fact.currency ?? 'USD')} vs previous
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Horizontal bars for one measure across categories.
 *
 * One hue, because this compares magnitudes — colour here would encode an
 * identity the labels already carry. The one exception is a negative value in
 * a budget series, where going over is a state, not a bigger number.
 */
export function BarSeries({ fact, onDrill }: { fact: SeriesFact; onDrill: FactClickHandler }) {
  const rows = fact.rows.filter((row) => row.value !== null);
  if (rows.length === 0) return <p className="empty">Nothing in this period.</p>;

  const scale = Math.max(...rows.map((row) => Math.abs(row.value ?? 0)), 1);

  return (
    <div className="bars">
      {rows.map((row) => {
        const value = row.value ?? 0;
        const over = value < 0;
        return (
          <button
            key={row.key}
            className="bar-row"
            onClick={() => onDrill({ label: row.label, sourceTxnIds: row.sourceTxnIds })}
            title={`${row.sourceTxnIds.length} transactions — click to see them`}
          >
            <span className="bar-label">{row.label}</span>
            <span className="bar-track">
              <span
                className={`bar-fill${over ? ' over' : ''}`}
                style={{ width: `${Math.max((Math.abs(value) / scale) * 100, 1.5)}%` }}
              />
            </span>
            <span className="bar-value">
              {over && '⚠ '}
              {formatSeriesValue(fact, value)}
              {row.share !== undefined && ` · ${Math.round(row.share * 100)}%`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SeriesTable({ fact, onDrill }: { fact: SeriesFact; onDrill: FactClickHandler }) {
  if (fact.rows.length === 0) return <p className="empty">Nothing in this period.</p>;

  return (
    <div className="rows">
      {fact.rows.map((row) => (
        <button
          key={row.key}
          className="row"
          onClick={() => onDrill({ label: row.label, sourceTxnIds: row.sourceTxnIds })}
        >
          <span className="row-date">{row.sourceTxnIds.length}×</span>
          <span className="row-main">
            <span className="row-title">{row.label}</span>
          </span>
          <span className="row-amount">{formatSeriesValue(fact, row.value)}</span>
        </button>
      ))}
    </div>
  );
}
