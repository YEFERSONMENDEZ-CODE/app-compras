import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { PieChart, BarChart } from "react-native-gifted-charts";
import { theme, CATEGORY_COLORS, CATEGORY_LABEL } from "@/src/theme";
import { formatMoney, formatMoneyCompact } from "@/src/currency";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const W = Dimensions.get("window").width;

export default function ReportsScreen() {
  const { user } = useAuth();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const currency = user?.preferred_currency || "PYG";

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const rep = await api<any>(`/reports/monthly?month=${month}`);
      setReport(rep);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = report?.total_by_currency?.[currency] || 0;

  const byCategoryEntries: [string, number][] = report
    ? Object.entries(report.by_category || {}).map(([k, v]: any) => [k, v[currency] || 0])
    : [];
  const catTotal = byCategoryEntries.reduce((s, [, v]) => s + v, 0);
  const pieData = byCategoryEntries
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      value: v,
      color: CATEGORY_COLORS[k] || "#6B7280",
      text: catTotal > 0 ? `${Math.round((v / catTotal) * 100)}%` : "",
      textColor: "#fff",
      textSize: 11,
    }));

  const byMarketEntries: [string, number][] = report
    ? Object.entries(report.by_market || {}).map(([k, v]: any) => [k, v[currency] || 0])
    : [];
  const barData = byMarketEntries
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => ({
      value: v,
      label: k.length > 8 ? k.substring(0, 7) + "…" : k,
      frontColor: theme.colors.brand,
      topLabelComponent: () => (
        <Text style={{ color: theme.colors.muted, fontSize: 9, marginBottom: 2 }}>
          {formatMoneyCompact(v, currency)}
        </Text>
      ),
    }));

  const maxBar = barData.length ? Math.max(...barData.map((b) => b.value)) : 100;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="reports-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Reportes</Text>
        <Text style={styles.subtitle}>
          {new Date().toLocaleDateString("es-PY", { month: "long", year: "numeric" })}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Gasto total</Text>
                <Text style={styles.summaryValue}>{formatMoney(total, currency)}</Text>
              </View>
              <View style={styles.row}>
                <View style={[styles.smallCard, { marginRight: 6 }]}>
                  <Text style={styles.summaryLabel}>Compras</Text>
                  <Text style={styles.summaryBig}>{report?.purchase_count || 0}</Text>
                </View>
                <View style={[styles.smallCard, { marginLeft: 6 }]}>
                  <Text style={styles.summaryLabel}>Productos</Text>
                  <Text style={styles.summaryBig}>{report?.item_count || 0}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.section}>Por categoría</Text>
            <View style={styles.card} testID="category-chart-card">
              {pieData.length === 0 ? (
                <Text style={styles.noData}>Sin datos aún</Text>
              ) : (
                <View style={{ alignItems: "center" }}>
                  <PieChart
                    data={pieData}
                    donut
                    radius={90}
                    innerRadius={55}
                    innerCircleColor={theme.colors.surface}
                    centerLabelComponent={() => (
                      <View style={{ alignItems: "center" }}>
                        <Text style={{ fontSize: 10, color: theme.colors.muted }}>Total</Text>
                        <Text style={{ fontSize: 14, fontWeight: "800", color: theme.colors.onSurface }}>
                          {formatMoneyCompact(catTotal, currency)}
                        </Text>
                      </View>
                    )}
                  />
                  <View style={styles.legend}>
                    {byCategoryEntries.filter(([, v]) => v > 0).map(([k, v]) => (
                      <View key={k} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: CATEGORY_COLORS[k] }]} />
                        <Text style={styles.legendLabel}>{CATEGORY_LABEL[k] || k}</Text>
                        <Text style={styles.legendVal}>{formatMoneyCompact(v, currency)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            <Text style={styles.section}>Por mercado</Text>
            <View style={styles.card} testID="market-chart-card">
              {barData.length === 0 ? (
                <Text style={styles.noData}>Sin datos aún</Text>
              ) : (
                <BarChart
                  data={barData}
                  barWidth={28}
                  spacing={18}
                  barBorderRadius={6}
                  yAxisThickness={0}
                  xAxisThickness={0}
                  hideRules
                  hideYAxisText
                  maxValue={maxBar * 1.2}
                  xAxisLabelTextStyle={{ color: theme.colors.muted, fontSize: 10 }}
                  disablePress
                />
              )}
            </View>

            <View style={{ height: 100 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  header: { padding: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.onSurface },
  subtitle: { fontSize: 13, color: theme.colors.muted, marginTop: 2, textTransform: "capitalize" },
  scroll: { padding: theme.spacing.lg, paddingTop: theme.spacing.sm },
  summary: { marginBottom: theme.spacing.lg },
  summaryCard: { backgroundColor: theme.colors.surfaceInverse, borderRadius: theme.radius.md, padding: theme.spacing.xl, marginBottom: theme.spacing.md },
  summaryLabel: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600" },
  summaryValue: { color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  row: { flexDirection: "row" },
  smallCard: { flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.lg },
  summaryBig: { fontSize: 24, fontWeight: "800", color: theme.colors.onSurface, marginTop: 4 },
  section: { fontSize: 14, fontWeight: "700", color: theme.colors.onSurface, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  noData: { textAlign: "center", color: theme.colors.muted, padding: theme.spacing.lg },
  legend: { marginTop: theme.spacing.lg, width: "100%", gap: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 13, color: theme.colors.onSurface },
  legendVal: { fontSize: 13, fontWeight: "700", color: theme.colors.onSurface },
});
