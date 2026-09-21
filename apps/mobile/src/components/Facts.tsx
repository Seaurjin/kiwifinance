/**
 * Fact rendering for iOS.
 *
 * Same contract as the web components: these display a Fact and never compute
 * one. Tapping a figure opens the transactions behind it (FR-ANA-05), which is
 * the whole reason sourceTxnIds travels with every number.
 */

import { compareFacts, formatFactValue, formatMoneyMinor, formatSeriesValue } from '@kiwi/client';
import type { ScalarFact, SeriesFact } from '@kiwi/metrics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Theme, type as typeScale } from '../theme.ts';

export interface DrillTarget {
  label: string;
  sourceTxnIds: readonly string[];
}

export function KpiRow({
  theme,
  facts,
  comparison,
  onDrill,
}: {
  theme: Theme;
  facts: readonly ScalarFact[];
  comparison?: readonly ScalarFact[] | undefined;
  onDrill: (target: DrillTarget) => void;
}) {
  return (
    <View style={[styles.kpiRow, { borderColor: theme.ruleStrong }]}>
      {facts.map((fact, index) => {
        const value = formatFactValue(fact);
        const change = compareFacts(fact, comparison?.[index]);

        return (
          <Pressable
            key={fact.metric}
            onPress={() => onDrill(fact)}
            style={({ pressed }) => [
              styles.kpi,
              { borderColor: theme.rule },
              pressed && { backgroundColor: theme.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${fact.label}, ${value.text}. ${fact.sourceTxnIds.length} transactions.`}
          >
            <Text style={[typeScale.eyebrow, { color: theme.muted }]} numberOfLines={1}>
              {fact.label.toUpperCase()}
            </Text>
            <Text
              style={[
                value.available ? typeScale.hero : typeScale.meta,
                { color: value.available ? theme.ink : theme.muted, marginTop: 6 },
              ]}
            >
              {value.text}
            </Text>
            {change !== null && fact.unit === 'money' && (
              <Text style={[typeScale.meta, { color: theme.muted, marginTop: 3 }]}>
                {change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■'}{' '}
                {formatMoneyMinor(Math.abs(change.delta), fact.currency ?? 'USD')}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Horizontal bars, one hue. The measure is a magnitude and the labels already
 * carry identity, so colour would encode nothing — except on a budget series,
 * where a negative value is a state and earns the warning colour.
 */
export function BarSeries({
  theme,
  fact,
  onDrill,
}: {
  theme: Theme;
  fact: SeriesFact;
  onDrill: (target: DrillTarget) => void;
}) {
  const rows = fact.rows.filter((row) => row.value !== null);
  if (rows.length === 0) {
    return <Text style={[typeScale.meta, { color: theme.muted }]}>Nothing in this period.</Text>;
  }

  const scale = Math.max(...rows.map((row) => Math.abs(row.value ?? 0)), 1);

  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => {
        const value = row.value ?? 0;
        const over = value < 0;
        return (
          <Pressable
            key={row.key}
            onPress={() => onDrill({ label: row.label, sourceTxnIds: row.sourceTxnIds })}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}, ${formatSeriesValue(fact, value)}`}
          >
            <View style={styles.barHeader}>
              <Text style={[typeScale.body, { color: theme.ink2, flex: 1 }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[typeScale.amount, { color: over ? theme.risk : theme.ink }]}>
                {over ? '⚠ ' : ''}
                {formatSeriesValue(fact, value)}
                {row.share !== undefined ? ` · ${Math.round(row.share * 100)}%` : ''}
              </Text>
            </View>
            <View style={[styles.barTrack, { backgroundColor: theme.rule }]}>
              <View
                style={{
                  height: '100%',
                  borderRadius: 3,
                  backgroundColor: over ? theme.risk : theme.accent,
                  width: `${Math.max((Math.abs(value) / scale) * 100, 1.5)}%`,
                }}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  kpiRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kpi: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  barHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 5 },
  barTrack: { height: 12, borderRadius: 3, overflow: 'hidden' },
});
