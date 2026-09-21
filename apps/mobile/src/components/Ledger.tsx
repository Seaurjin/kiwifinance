/**
 * Transaction rows, the capture bar and the trace sheet.
 *
 * The capture bar is the reason the app exists: one line in, several drafts
 * out, nothing written until the drafts are looked at. On device this is where
 * the Share Extension and the Shortcuts intent hand off to (FR-CAP-05/06);
 * both funnel into the same extract → review → commit path as typing does.
 */

import { formatMoneyMinor, type Draft, type KiwiClient } from '@kiwi/client';
import type { Transaction } from '@kiwi/ledger';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { type Theme, type as typeScale } from '../theme.ts';

export function Chip({ theme, label, tone }: { theme: Theme; label: string; tone: 'review' | 'fx' }) {
  const color = tone === 'review' ? theme.caution : theme.accent;
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[typeScale.meta, { color, fontSize: 10.5 }]}>{label}</Text>
    </View>
  );
}

export function TransactionRows({
  theme,
  transactions,
  categories,
  onOpen,
}: {
  theme: Theme;
  transactions: readonly Transaction[];
  categories: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  if (transactions.length === 0) {
    return <Text style={[typeScale.meta, { color: theme.muted, paddingVertical: 14 }]}>Nothing here yet.</Text>;
  }

  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.rule }}>
      {transactions.map((txn) => {
        const foreign = txn.currency !== txn.baseCurrency;
        return (
          <Pressable
            key={txn.id}
            onPress={() => onOpen(txn.id)}
            style={({ pressed }) => [
              styles.row,
              { borderColor: theme.rule },
              pressed && { backgroundColor: theme.accentSoft },
            ]}
          >
            <Text style={[typeScale.meta, { color: theme.muted, width: 44 }]}>
              {txn.date.slice(5)}
            </Text>

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.titleLine}>
                <Text style={[typeScale.body, { color: theme.ink }]} numberOfLines={1}>
                  {txn.merchantName ?? txn.note ?? 'Untitled'}
                </Text>
                {txn.status === 'pending_review' && <Chip theme={theme} label="review" tone="review" />}
                {foreign && <Chip theme={theme} label={txn.currency} tone="fx" />}
              </View>
              <Text style={[typeScale.meta, { color: theme.muted }]} numberOfLines={1}>
                {txn.categoryId === null
                  ? 'Uncategorised'
                  : (categories.get(txn.categoryId) ?? 'Uncategorised')}
                {txn.kind !== 'expense' && txn.kind !== 'income' ? ` · ${txn.kind}` : ''}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={[typeScale.amount, { color: txn.amountMinor > 0 ? theme.accent : theme.ink }]}
              >
                {formatMoneyMinor(txn.amountMinor, txn.currency)}
              </Text>
              {foreign && (
                <Text style={[typeScale.meta, { color: theme.muted }]}>
                  {formatMoneyMinor(txn.baseAmountMinor, txn.baseCurrency)}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CaptureBar({
  theme,
  client,
  ledgerId,
  accountId,
  onCommitted,
}: {
  theme: Theme;
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
      if (result.drafts.length === 0) setError('No amount found. Try “lunch 35, taxi 22”.');
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

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void extract()}
          placeholder="lunch 35, taxi 22, water 3"
          placeholderTextColor={theme.muted}
          returnKeyType="done"
          style={[
            styles.input,
            { borderColor: theme.ruleStrong, color: theme.ink, backgroundColor: theme.surface },
          ]}
          accessibilityLabel="Describe what you spent"
        />
        <Pressable
          onPress={() => void extract()}
          disabled={busy}
          style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={[typeScale.body, { color: theme.onAccent }]}>{busy ? '…' : 'Read'}</Text>
        </Pressable>
      </View>

      {error !== null && (
        <Text style={[typeScale.meta, { color: theme.risk, marginTop: 8 }]}>{error}</Text>
      )}

      {drafts !== null && drafts.length > 0 && (
        <View style={{ marginTop: 12 }}>
          {drafts.map((draft, index) => (
            <View
              key={`${draft.merchantName}-${index}`}
              style={[styles.draft, { borderColor: theme.rule }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.body, { color: theme.ink }]}>
                  {draft.merchantName ?? 'Unnamed'}
                </Text>
                <Text style={[typeScale.meta, { color: theme.muted }]}>
                  {draft.categorySlug ?? 'no category'} · {Math.round(draft.confidence * 100)}%
                  {draft.confidence < 0.8 ? ' — waits for you' : ''}
                </Text>
              </View>
              <Text style={[typeScale.amount, { color: theme.ink }]}>
                {formatMoneyMinor(draft.amountMinor, draft.currency)}
              </Text>
            </View>
          ))}
          <Text style={[typeScale.meta, { color: theme.muted, marginTop: 8 }]}>
            Read by {extractedBy}. Nothing written yet.
          </Text>
          <Pressable
            onPress={() => void commit()}
            disabled={busy}
            style={[styles.primary, { backgroundColor: theme.accent, marginTop: 10, alignSelf: 'flex-start' }]}
          >
            <Text style={[typeScale.body, { color: theme.onAccent }]}>
              Record {drafts.length} {drafts.length === 1 ? 'entry' : 'entries'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

interface Provenance {
  kind: string;
  ref: string;
  extractedBy: string | null;
}

export function TraceSheet({
  theme,
  client,
  transactionId,
  categories,
  onClose,
  onChanged,
}: {
  theme: Theme;
  client: KiwiClient;
  transactionId: string;
  categories: Map<string, string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [provenance, setProvenance] = useState<Provenance | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client.trace(transactionId).then((result) => {
      if (cancelled) return;
      setTxn(result.transaction);
      setProvenance(result.provenance as Provenance | null);
    });
    return () => {
      cancelled = true;
    };
  }, [client, transactionId]);

  const foreign = txn !== null && txn.currency !== txn.baseCurrency;

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Pressable onPress={onClose} style={{ alignSelf: 'flex-end' }}>
          <Text style={[typeScale.body, { color: theme.accent }]}>Close</Text>
        </Pressable>

        {txn === null ? (
          <ActivityIndicator color={theme.muted} />
        ) : (
          <>
            <Text style={[typeScale.title, { color: theme.ink, marginTop: 8 }]}>
              {txn.merchantName ?? txn.note ?? 'Untitled'}
            </Text>
            <Text style={[typeScale.meta, { color: theme.muted, marginTop: 4 }]}>
              {txn.date} ·{' '}
              {txn.categoryId === null
                ? 'Uncategorised'
                : (categories.get(txn.categoryId) ?? 'Uncategorised')}
            </Text>

            <View style={{ marginTop: 18, gap: 8 }}>
              <Field theme={theme} label="Amount paid" value={formatMoneyMinor(txn.amountMinor, txn.currency)} />
              {foreign && (
                <>
                  <Field
                    theme={theme}
                    label={`In ${txn.baseCurrency}`}
                    value={formatMoneyMinor(txn.baseAmountMinor, txn.baseCurrency)}
                  />
                  <Field theme={theme} label="Rate used" value={`${txn.fxRate} · ${txn.fxRateSource.replace('_', ' ')}`} />
                  <Field theme={theme} label="Rate date" value={txn.fxAsOf} />
                </>
              )}
              <Field theme={theme} label="Captured by" value={txn.source} />
              {txn.aiConfidence !== null && (
                <Field theme={theme} label="Confidence" value={`${Math.round(txn.aiConfidence * 100)}%`} />
              )}
              <Field theme={theme} label="Status" value={txn.status} />
            </View>

            {foreign && (
              <Text style={[typeScale.meta, { color: theme.ink2, marginTop: 16 }]}>
                The rate was frozen when this was recorded, so this figure reads the same in a year
                even after the market moves.
              </Text>
            )}

            {provenance !== null && (
              <Text style={[typeScale.meta, { color: theme.ink2, marginTop: 10 }]}>
                From a {provenance.kind}: {provenance.ref}
                {provenance.extractedBy !== null ? `, read by ${provenance.extractedBy}` : ''}.
              </Text>
            )}

            {txn.status === 'pending_review' && (
              <Pressable
                onPress={() => {
                  void client.updateTransaction(txn.id, { status: 'confirmed' }).then(() => {
                    onChanged();
                    onClose();
                  });
                }}
                style={[styles.primary, { backgroundColor: theme.accent, marginTop: 20, alignSelf: 'flex-start' }]}
              >
                <Text style={[typeScale.body, { color: theme.onAccent }]}>Confirm</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

function Field({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[typeScale.meta, { color: theme.muted }]}>{label}</Text>
      <Text style={[typeScale.amount, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 1 },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primary: { borderRadius: 3, paddingHorizontal: 14, justifyContent: 'center', paddingVertical: 10 },
  draft: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
});
