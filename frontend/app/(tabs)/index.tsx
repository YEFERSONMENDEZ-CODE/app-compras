import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, Platform, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Plus, Camera, Receipt, ShoppingBasket, TrendingUp, Share2 } from "lucide-react-native";
import { theme } from "@/src/theme";
import { formatMoney } from "@/src/currency";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { shareToWhatsApp } from "@/src/whatsapp";

type Purchase = {
  id: string; name?: string | null; market_name: string; total: number; currency: string;
  date: string; items: { name: string; quantity?: number; unit?: string; price?: number }[];
};

function purchaseShareMessage(purchase: Purchase): string {
  const date = new Date(purchase.date).toLocaleDateString("es-PY", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const lines = [
    `🛍️ *${purchase.name || "Compra"}*`,
    `🏪 ${purchase.market_name}`,
    `📅 ${date}`,
    "",
    "*Productos:*",
    ...purchase.items.map((item) => {
      const quantity = item.quantity || 1;
      const amount = item.price != null ? ` — ${formatMoney(item.price * quantity, purchase.currency)}` : "";
      return `• ${item.name} (${quantity} ${item.unit === "kg" ? "kg" : "un"})${amount}`;
    }),
    "",
    `*Total gastado:* ${formatMoney(purchase.total, purchase.currency)}`,
  ];
  return lines.join("\n");
}

export default function Dashboard() {
  const { user, mode, needsGuestName, setGuestName } = useAuth();
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const showNameDialog = needsGuestName || editingName;
  const isGuest = mode === "guest";
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

  const sharePurchase = async (purchase: Purchase) => {
    try {
      await shareToWhatsApp(purchaseShareMessage(purchase));
    } catch (error) {
      console.warn("No se pudo compartir la compra por WhatsApp", error);
      const message = "No se pudo abrir WhatsApp para compartir la compra.";
      if (Platform.OS === "web" && typeof window !== "undefined") window.alert(message);
      else Alert.alert("Error al compartir", message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="dashboard-screen">
      <Modal visible={showNameDialog} transparent animationType="fade" onRequestClose={() => { setEditingName(false); void setGuestName(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Cómo te llamas?</Text>
            <Text style={styles.modalText}>Lo usaremos para saludarte en la pantalla principal.</Text>
            <TextInput
              testID="guest-name-input"
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Tu nombre"
              placeholderTextColor={theme.colors.muted}
              style={styles.modalInput}
              autoCapitalize="words"
              maxLength={40}
              autoFocus
            />
            <Pressable
              testID="guest-name-save"
              style={styles.modalPrimary}
              onPress={async () => { await setGuestName(nameDraft); setEditingName(false); }}
            >
              <Text style={styles.modalPrimaryText}>Guardar</Text>
            </Pressable>
            <Pressable
              testID="guest-name-skip"
              style={styles.modalSkip}
              onPress={async () => { await setGuestName(null); setEditingName(false); }}
            >
              <Text style={styles.modalSkipText}>Ahora no</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brand} />}
      >
        <View style={styles.header}>
          <Pressable
            disabled={!isGuest}
            onPress={() => { setNameDraft(user?.name || ""); setEditingName(true); }}
            testID="greeting-btn"
          >
            <Text style={styles.hi}>Hola, {user?.name?.trim().split(" ")[0] || "amigo"}</Text>
            <Text style={styles.sub}>{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</Text>
          </Pressable>
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
              <View
                key={p.id}
                testID={`purchase-row-${p.id}`}
                style={styles.row}
              >
                <Pressable
                  onPress={() => router.push({ pathname: "/add-purchase", params: { purchaseId: p.id } })}
                  style={({ pressed }) => [styles.purchaseMain, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.rowIcon}>
                    <Receipt color={theme.colors.brand} size={18} />
                  </View>
                  <View style={styles.purchaseContent}>
                    <Text style={styles.rowTitle}>{p.name || "Compra"}</Text>
                    <Text style={styles.rowSub}>
                      {p.market_name} · {new Date(p.date).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" })}
                    </Text>
                    <Text style={styles.rowItems} numberOfLines={2}>
                      {p.items.slice(0, 3).map((item) => item.name).join(", ")}
                      {p.items.length > 3 ? ` y ${p.items.length - 3} más` : ""}
                    </Text>
                  </View>
                  <View style={styles.amountBlock}>
                    <Text style={styles.amountLabel}>Gastado</Text>
                    <Text style={styles.rowAmount}>{formatMoney(p.total, p.currency)}</Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Compartir ${p.name || "compra"} por WhatsApp`}
                  testID={`share-purchase-${p.id}`}
                  onPress={() => sharePurchase(p)}
                  style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.6 }]}
                >
                  <Share2 color="#25D366" size={19} />
                </Pressable>
              </View>
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.onSurface },
  modalText: { marginTop: 6, marginBottom: 14, color: theme.colors.muted },
  modalInput: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: theme.colors.onSurface },
  modalPrimary: { marginTop: 14, backgroundColor: theme.colors.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  modalPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  modalSkip: { marginTop: 6, paddingVertical: 10, alignItems: "center" },
  modalSkipText: { color: theme.colors.muted, fontWeight: "600" },
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
  row: { flexDirection: "row", alignItems: "center", minHeight: 88, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  purchaseMain: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md, padding: theme.spacing.md },
  shareBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", marginRight: 8 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  purchaseContent: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  rowSub: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  rowItems: { fontSize: 12, color: theme.colors.onSurfaceSecondary, marginTop: 5 },
  amountBlock: { alignItems: "flex-end", maxWidth: 118 },
  amountLabel: { fontSize: 10, color: theme.colors.muted, marginBottom: 3 },
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
