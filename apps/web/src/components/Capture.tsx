/**
 * The capture bar.
 *
 * One line of text becomes several drafts (FR-CAP-04). The drafts are shown
 * before anything is written, because an extractor is a guess and the user is
 * the one who decides. Anything below the confidence bar is committed into the
 * review queue rather than straight into the totals.
 */

import { formatMoneyMinor, type Draft, type KiwiClient } from '@kiwi/client';
import { useState } from 'react';

const EXAMPLES = [
  'lunch 35, taxi 22, water 3',
  'ramen 1200 JPY, coffee ¥28',
  'groceries 64.20, flight 480 SGD',
];

export function CaptureBar({
  client,
  ledgerId,
  accountId,
  onCommitted,
}: {
  client: KiwiClient;
  ledgerId: string;
  accountId: string;
  onCommitted: () => void;
}) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [extractedBy, setExtractedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    if (text.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.extract(ledgerId, text);
      setDrafts(result.drafts);
      setExtractedBy(result.extractedBy);
      if (result.drafts.length === 0) {
        setError('No amount found in that. Try "lunch 35, taxi 22".');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (drafts === null || drafts.length === 0) return;
    setBusy(true);
    try {
      await client.commit(ledgerId, { accountId, source: 'voice', extractedBy, drafts });
      setDrafts(null);
      setText('');
      onCommitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function discard(index: number) {
    setDrafts((current) => (current ?? []).filter((_, i) => i !== index));
  }

  return (
    <section>
      <h2>Record something</h2>

      <div className="capture">
        <input
          type="text"
          value={text}
          placeholder="Say it in one line — “lunch 35, taxi 22, water 3”"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void extract();
          }}
          aria-label="Describe what you spent"
        />
        <button className="primary" onClick={() => void extract()} disabled={busy}>
          {busy ? 'Reading…' : 'Read it'}
        </button>
      </div>

      <p className="hint">
        Try: {EXAMPLES.map((example, index) => (
          <span key={example}>
            {index > 0 && ' · '}
            <button className="quiet" onClick={() => setText(example)}>
              {example}
            </button>
          </span>
        ))}
      </p>

      {error !== null && <p className="note error">{error}</p>}

      {drafts !== null && drafts.length > 0 && (
        <>
          <div className="drafts">
            {drafts.map((draft, index) => (
              <div className="draft" key={`${draft.merchantName}-${index}`}>
                <span>
                  {draft.merchantName ?? 'Unnamed'}
                  <span className="why">
                    {' '}
                    · {draft.categorySlug ?? 'no category'} · confidence{' '}
                    {Math.round(draft.confidence * 100)}%
                    {draft.confidence < 0.8 && ' — will wait for your confirmation'}
                  </span>
                </span>
                <span className="num">{formatMoneyMinor(draft.amountMinor, draft.currency)}</span>
                <button className="quiet" onClick={() => discard(index)} aria-label="Discard">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="hint">
            Read by <span className="mono">{extractedBy}</span>. Nothing has been written yet.
          </p>
          <button className="primary" onClick={() => void commit()} disabled={busy}>
            Record {drafts.length} {drafts.length === 1 ? 'entry' : 'entries'}
          </button>
        </>
      )}
    </section>
  );
}
