import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Plus, Camera, Receipt, ShoppingBasket, TrendingUp } from "lucide-react-native";
import { theme, CATEGORY_COLORS, CATEGORY_LABEL } from "@/src/theme";
import { formatMoney } from "@/src/currency";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type Purchase = {
  id: string; market_name: string; total: number; currency: string;
  date: string; items: any[];
};

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [report, setReport] = useState<any>(null);

  const currency = user?.preferred_currency || "PYG";

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const [ps, rep] = await Promise.all([
        api<Purchase[]>(`/purchases?month=${month}`),
        api<any>(`/reports/monthly?month=${month}`),
      ]);
      setPurchases(ps);
      setReport(rep);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const monthTotal = report?.total_by_currency?.[currency] || 0;
  const purchaseCount = report?.purchase_count || 0;
  const itemCount = report?.item_count || 0;

  const monthName = new Date().toLocaleDateString("es-PY", { month: "long", year: "numeric" });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brand} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.hi}>Hola, {user?.name?.split(" ")[0] || "amigo"}</Text>
            <Text style={styles.sub}>{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</Text>
          </View>
          <View style={styles.avatar}>
            <ShoppingBasket color="#fff" size={20} />
          </View>
        </View>

        <View style={styles.balanceCard} testID="monthly-total-card">
          <Text style={styles.balanceLabel}>Total del mes</Text>
          <Text style={styles.balanceValue} testID="monthly-total-value">
            {formatMoney(monthTotal, currency)}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Receipt color={theme.colors.brandTertiary} size={14} />
              <Text style={styles.metaText}>{purchaseCount} compras</Text>
            </View>
            <View style={styles.dot} />
            <View style={styles.metaItem}>
              <TrendingUp color={theme.colors.brandTertiary} size={14} />
              <Text style={styles.metaText}>{itemCount} productos</Text>
            </View>
          </View>
        </View>

        <View style={styles.quickRow}>
          <Pressable
            testID="quick-scan-btn"
            onPress={() => router.push("/scan-receipt")}
            style={({ pressed }) => [styles.qCard, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.qIcon, { backgroundColor: theme.colors.brandSecondary }]}>
              <Camera color={theme.colors.brand} size={22} />
            </View>
            <Text style={styles.qTitle}>Escanear</Text>
            <Text style={styles.qSub}>Factura con IA</Text>
          </Pressable>
          <Pressable
            testID="quick-add-btn"
            onPress={() => router.push("/add-purchase")}
            style={({ pressed }) => [styles.qCard, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.qIcon, { backgroundColor: "#FEF3C7" }]}>
              <Plus color="#D97706" size={22} />
            </View>
            <Text style={styles.qTitle}>Agregar</Text>
            <Text style={styles.qSub}>Compra manual</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Compras recientes</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 20 }} />
        ) : purchases.length === 0 ? (
          <View style={styles.empty} testID="empty-purchases">
            <View style={styles.emptyIcon}>
              <ShoppingBasket color={theme.colors.muted} size={32} />
            </View>
            <Text style={styles.emptyTitle}>Sin compras este mes</Text>
            <Text style={styles.emptySub}>Escanea una factura o agrega manualmente</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {purchases.slice(0, 10).map((p) => (
              <Pressable
                key={p.id}
                testID={`purchase-row-${p.id}`}
                onPress={() => router.push({ pathname: "/add-purchase", params: { purchaseId: p.id } })}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.rowIcon}>
                  <Receipt color={theme.colors.brand} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{p.market_name}</Text>
                  <Text style={styles.rowSub}>
                    {new Date(p.date).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })} · {p.items.length} items
                  </Text>
                </View>
                <Text style={styles.rowAmount}>{formatMoney(p.total, p.currency)}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Pressable
        testID="fab-add-purchase"
        onPress={() => router.push("/add-purchase")}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
      >
        <Plus color="#fff" size={26} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  scroll: { padding: theme.spacing.lg, paddingBottom: 100 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  hi: { fontSize: 22, fontWeight: "800", color: theme.colors.onSurface },
  sub: { fontSize: 13, color: theme.colors.muted, marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  balanceCard: {
    backgroundColor: theme.colors.surfaceInverse,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  balanceLabel: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "600" },
  balanceValue: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: theme.spacing.md, gap: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "500" },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.4)" },
  quickRow: { flexDirection: "row", gap: theme.spacing.md, marginBottom: theme.spacing.xl },
  qCard: {
    flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
    padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border,
  },
  qIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  qTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.onSurface },
  qSub: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  sectionHeader: { marginBottom: theme.spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  list: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    padding: theme.spacing.md, minHeight: 64, borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  rowSub: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: "700", color: theme.colors.onSurface },
  empty: { alignItems: "center", padding: theme.spacing.xxl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  emptySub: { fontSize: 13, color: theme.colors.muted, marginTop: 4 },
  fab: {
    position: "absolute", bottom: 96, right: theme.spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
