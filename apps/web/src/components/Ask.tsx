/**
 * Ask for a report (FR-ANA-07).
 *
 * The question goes to the planner, which answers with a *spec* — which
 * figures to compute over which period — and the engine computes them. The
 * panel below shows the plan before the figures: the period it settled on,
 * the filters it applied, and anything in the question it could not use.
 *
 * That order is deliberate. A number whose question you cannot see is a
 * number you have to trust; a number with its query attached is one you can
 * check.
 */

import type { KiwiClient, PlanNote, ReportPlan } from '@kiwi/client';
import { useState } from 'react';

const EXAMPLES = [
  'what did I spend last month vs the month before?',
  'subscriptions over the last 12 months',
  'anything unusual in the last 90 days',
  'how much of my spending is in foreign currency this year',
];

const NOTE_LABEL: Record<PlanNote['kind'], string> = {
  assumption: 'assumed',
  filter: 'filtered',
  ignored: 'not answered',
  fallback: 'fell back',
};

export function AskBar({
  client,
  ledgerId,
  plan,
  onPlanned,
  onCleared,
  onSaved,
}: {
  client: KiwiClient;
  ledgerId: string;
  plan: ReportPlan | null;
  onPlanned: (result: { plan: ReportPlan; factSet: unknown }) => void;
  onCleared: () => void;
  onSaved: (savedId: string, name: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function ask(asked: string) {
    if (asked.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await client.planReport(ledgerId, asked);
      onPlanned(result as { plan: ReportPlan; factSet: unknown });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (plan === null) return;
    setBusy(true);
    try {
      const result = await client.saveReport(ledgerId, plan.spec.title, plan.spec);
      setSaved(result.report.name);
      onSaved(result.report.id, result.report.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ask">
      <h2>Ask for a report</h2>
      <form
        className="capture"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <input
          value={question}
          placeholder="what did I spend on groceries last month?"
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Ask for a report"
        />
        <button type="submit" disabled={busy || question.trim().length === 0}>
          {busy ? 'Planning…' : 'Plan it'}
        </button>
        {plan !== null && (
          <button
            type="button"
            onClick={() => {
              setQuestion('');
              setShowSpec(false);
              setSaved(null);
              onCleared();
            }}
          >
            Clear
          </button>
        )}
      </form>

      {plan === null && (
        <p className="hint">
          Try:{' '}
          {EXAMPLES.map((example, index) => (
            <span key={example}>
              {index > 0 && ' · '}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setQuestion(example);
                  void ask(example);
                }}
              >
                {example}
              </button>
            </span>
          ))}
        </p>
      )}

      {error !== null && <p className="note error">{error}</p>}

      {plan !== null && (
        <div className="plan">
          <div className="plan-head">
            <span className="chip">{plan.source === 'model' ? 'planned by a model' : 'planned from templates'}</span>
            <span className="chip">{Math.round(plan.confidence * 100)}% sure of the question</span>
            <span className="plan-period">
              {plan.spec.period.from} → {plan.spec.period.to}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="quiet" onClick={() => setShowSpec(!showSpec)}>
              {showSpec ? 'Hide the query' : 'Show the query'}
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || saved !== null}>
              {saved === null ? 'Save this report' : 'Saved'}
            </button>
          </div>

          {plan.notes.length > 0 && (
            <ul className="plan-notes">
              {plan.notes.map((note) => (
                <li key={note.message} className={`plan-note ${note.kind}`}>
                  <span className="plan-note-kind">{NOTE_LABEL[note.kind]}</span>
                  {note.message}
                </li>
              ))}
            </ul>
          )}

          {showSpec && (
            <pre className="spec">{JSON.stringify(plan.spec, null, 2)}</pre>
          )}
        </div>
      )}
    </section>
  );
}
