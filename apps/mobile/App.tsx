/**
 * Kiwi for iOS.
 *
 * Like the web app, this screen renders a fact set rather than a hand-built
 * dashboard: it asks the API for a standard report and lays out the blocks it
 * gets back. Neither client computes a figure, so the two cannot disagree.
 *
 * Running it needs a Mac with Xcode: `pnpm --filter @kiwi/mobile ios`, with the
 * API on :8787 (set EXPO_PUBLIC_API_URL to point at it from a device).
 */

import { KiwiClient, formatPeriod, isScalar, isSeries } from '@kiwi/client';
import type { Category, Ledger, Transaction } from '@kiwi/ledger';
import type { ScalarFact, SeriesFact } from '@kiwi/metrics';
import type { FactSet } from '@kiwi/report-spec';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BarSeries, KpiRow, type DrillTarget } from './src/components/Facts.tsx';
import { CaptureBar, TraceSheet, TransactionRows } from './src/components/Ledger.tsx';
import { useTheme, type as typeScale } from './src/theme.ts';

// A simulator reaches the host through localhost; a real device needs the
// machine's LAN address, which is what the env var is for.
const API_URL =
  process.env['EXPO_PUBLIC_API_URL'] ??
  (Platform.OS === 'ios' ? 'http://localhost:8787' : 'http://10.0.2.2:8787');

const client = new KiwiClient(API_URL);

const TABS = [
  { id: 'monthly_review', label: 'This month' },
  { id: 'fx_exposure', label: 'FX' },
  { id: 'budget_replan', label: 'Budget' },
] as const;

export default function App() {
  const theme = useTheme();

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [accountId, setAccountId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [reportId, setReportId] = useState<string>('monthly_review');
  const [factSet, setFactSet] = useState<FactSet | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [pending, setPending] = useState<Transaction[]>([]);
  const [openTxn, setOpenTxn] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [drillRows, setDrillRows] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const load = useCallback(async (report: string) => {
    const { ledgers } = await client.listLedgers();
    const first = ledgers[0];
    if (first === undefined) throw new Error('No ledger on the server yet.');

    const [overview, categoryList, reportResult, recentList, review] = await Promise.all([
      client.overview(first.id),
      client.categories(first.id),
      client.standardReport(first.id, report),
      client.transactions(first.id, { limit: 20 }),
      client.transactions(first.id, { status: 'pending_review', limit: 20 }),
    ]);

    setLedger(overview.ledger);
    setAccountId(overview.accounts[0]?.id ?? '');
    setCategories(categoryList.categories);
    setFactSet(reportResult.factSet);
    setRecent(recentList.transactions);
    setPending(review.transactions);
  }, []);

  const run = useCallback(
    async (report: string) => {
      try {
        await load(report);
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error ? `${cause.message}\nAPI: ${API_URL}` : String(cause),
        );
      }
    },
    [load],
  );

  useEffect(() => {
    void run(reportId).finally(() => setLoading(false));
    // Tab changes call run() directly so the whole screen does not remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (drill === null) {
      setDrillRows([]);
      return;
    }
    let cancelled = false;
    void client.lookup([...drill.sourceTxnIds]).then((result) => {
      if (!cancelled) setDrillRows(result.transactions);
    });
    return () => {
      cancelled = true;
    };
  }, [drill]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.fill, styles.center, { backgroundColor: theme.paper }]}>
        <ActivityIndicator color={theme.muted} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.paper }]}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.muted}
            onRefresh={() => {
              setRefreshing(true);
              void run(reportId).finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <Text style={[typeScale.eyebrow, { color: theme.muted }]}>KIWI FINANCE</Text>
        <Text style={[typeScale.title, { color: theme.ink, marginTop: 6 }]}>
          {error !== null ? 'Can’t reach the ledger' : (factSet?.specTitle ?? 'Ledger')}
        </Text>

        {error !== null ? (
          <Text style={[typeScale.body, { color: theme.risk, marginTop: 12 }]}>{error}</Text>
        ) : (
          <>
            <Text style={[typeScale.meta, { color: theme.muted, marginTop: 4 }]}>
              {ledger?.name} ·{' '}
              {factSet !== null && formatPeriod(factSet.basis.period.from, factSet.basis.period.to)}{' '}
              · in {factSet?.basis.baseCurrency} at the{' '}
              {factSet?.basis.fxMode === 'transaction' ? 'rate actually paid' : 'reporting rate'}
            </Text>

            <View style={styles.tabs}>
              {TABS.map((tab) => {
                const active = tab.id === reportId;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => {
                      setReportId(tab.id);
                      void run(tab.id);
                    }}
                    style={[
                      styles.tab,
                      {
                        borderColor: active ? theme.accent : theme.ruleStrong,
                        backgroundColor: active ? theme.accent : theme.surface,
                      },
                    ]}
                  >
                    <Text style={[typeScale.meta, { color: active ? theme.onAccent : theme.ink }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {factSet?.blocks.map((block) => {
              const scalars = block.facts.filter(isScalar);
              const series = block.facts.filter(isSeries);
              const comparison = block.comparisonFacts?.filter(isScalar);

              if (block.type === 'metric_row' && scalars.length > 0) {
                return (
                  <Section key={block.id} theme={theme} title={block.title ?? 'Headline'}>
                    <KpiRow
                      theme={theme}
                      facts={scalars as ScalarFact[]}
                      comparison={comparison as ScalarFact[] | undefined}
                      onDrill={setDrill}
                    />
                  </Section>
                );
              }

              if ((block.type === 'chart' || block.type === 'table') && series[0] !== undefined) {
                return (
                  <Section key={block.id} theme={theme} title={block.title ?? series[0].label}>
                    <BarSeries theme={theme} fact={series[0] as SeriesFact} onDrill={setDrill} />
                  </Section>
                );
              }

              if (block.type === 'narrative') {
                return (
                  <Section key={block.id} theme={theme} title="Reading">
                    <Text style={[typeScale.meta, { color: theme.ink2 }]}>
                      A written reading goes here. It is not generated yet: the narrator runs a
                      model, and every number it writes is checked against this fact set first.
                    </Text>
                  </Section>
                );
              }

              return null;
            })}

            {ledger !== null && accountId !== '' && (
              <Section theme={theme} title="Record something">
                <CaptureBar
                  theme={theme}
                  client={client}
                  ledgerId={ledger.id}
                  accountId={accountId}
                  onCommitted={() => void run(reportId)}
                />
              </Section>
            )}

            {pending.length > 0 && (
              <Section theme={theme} title={`Waiting for you · ${pending.length}`}>
                <Text style={[typeScale.meta, { color: theme.muted, marginBottom: 6 }]}>
                  Read with low confidence, so they are held out of every figure above.
                </Text>
                <TransactionRows
                  theme={theme}
                  transactions={pending}
                  categories={categoryNames}
                  onOpen={setOpenTxn}
                />
              </Section>
            )}

            <Section theme={theme} title="Recent">
              <TransactionRows
                theme={theme}
                transactions={recent}
                categories={categoryNames}
                onOpen={setOpenTxn}
              />
            </Section>
          </>
        )}
      </ScrollView>

      {drill !== null && (
        <Modalish theme={theme} title={drill.label} onClose={() => setDrill(null)}>
          <Text style={[typeScale.meta, { color: theme.muted, marginBottom: 10 }]}>
            Every transaction behind this figure — {drill.sourceTxnIds.length}{' '}
            {drill.sourceTxnIds.length === 1 ? 'row' : 'rows'}.
          </Text>
          <TransactionRows
            theme={theme}
            transactions={drillRows}
            categories={categoryNames}
            onOpen={(id) => {
              setDrill(null);
              setOpenTxn(id);
            }}
          />
        </Modalish>
      )}

      {openTxn !== null && (
        <TraceSheet
          theme={theme}
          client={client}
          transactionId={openTxn}
          categories={categoryNames}
          onClose={() => setOpenTxn(null)}
          onChanged={() => void run(reportId)}
        />
      )}
    </SafeAreaView>
  );
}

function Section({
  theme,
  title,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 28 }}>
      <Text
        style={[
          typeScale.section,
          {
            color: theme.muted,
            paddingBottom: 8,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.rule,
            marginBottom: 12,
          },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Modalish({
  theme,
  title,
  onClose,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper, paddingTop: 60 }]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Pressable onPress={onClose} style={{ alignSelf: 'flex-end' }}>
          <Text style={[typeScale.body, { color: theme.accent }]}>Close</Text>
        </Pressable>
        <Text style={[typeScale.title, { color: theme.ink, marginTop: 8 }]}>{title}</Text>
        <View style={{ marginTop: 14 }}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tab: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 7 },
});
