import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Plus, Trash2, Check, X, ShoppingCart, PackageX, Store, Search, RotateCcw, Trophy, Edit3 } from "lucide-react-native";
import { theme, CATEGORY_COLORS, CATEGORY_LABEL, CATEGORIES } from "@/src/theme";
import { formatMoney, currencyByCode } from "@/src/currency";
import { api } from "@/src/api";

type Item = {
  id: string;
  name: string;
  quantity: number;
  unit: "un" | "kg";
  category: string;
  status: "pending" | "bought" | "unavailable";
  paid_price?: number | null;
  paid_market_id?: string | null;
  paid_market_name?: string | null;
  paid_at?: string | null;
  note?: string | null;
};
type ShoppingList = { id: string; name: string; currency: string; items: Item[]; created_at: string };
type Market = { id: string; name: string; color: string };
type HistoryProduct = {
  name: string; category: string; unit: "un" | "kg";
  prices: { market_id: string; market_name: string; price: number; currency: string; date: string }[];
  cheapest_market_id?: string; cheapest_market_name?: string; cheapest_price?: number; cheapest_currency?: string;
};

export default function ShoppingListDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ShoppingList | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [buyItem, setBuyItem] = useState<Item | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [l, m] = await Promise.all([
        api<ShoppingList>(`/shopping-lists/${id}`),
        api<Market[]>("/markets"),
      ]);
      setList(l);
      setMarkets(m);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const updateItem = async (itemId: string, patch: any) => {
    try {
      const updated = await api<ShoppingList>(`/shopping-lists/${id}/items/${itemId}`, { method: "PUT", body: patch });
      setList(updated);
    } catch (e) { console.warn(e); }
  };

  const deleteItem = async (itemId: string) => {
    try {
      const updated = await api<ShoppingList>(`/shopping-lists/${id}/items/${itemId}`, { method: "DELETE" });
      setList(updated);
    } catch (e) { console.warn(e); }
  };

  const deleteList = async () => {
    const doDelete = async () => {
      try { await api(`/shopping-lists/${id}`, { method: "DELETE" }); router.back(); } catch (e) { console.warn(e); }
    };
    if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm("¿Eliminar esta lista?")) doDelete(); }
    else {
      Alert.alert("Eliminar lista", "¿Estás seguro?", [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const stats = useMemo(() => {
    if (!list) return { total: 0, bought: 0, unavailable: 0, pending: 0, spent: 0 };
    const items = list.items;
    const bought = items.filter((i) => i.status === "bought");
    const spent = bought.reduce((s, i) => s + (i.paid_price || 0) * (i.quantity || 1), 0);
    return {
      total: items.length,
      bought: bought.length,
      unavailable: items.filter((i) => i.status === "unavailable").length,
      pending: items.filter((i) => i.status === "pending").length,
      spent,
    };
  }, [list]);

  if (loading || !list) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ marginTop: 100 }} color={theme.colors.brand} />
      </SafeAreaView>
    );
  }

  const currInfo = currencyByCode(list.currency);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="shopping-list-detail">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-btn">
          <ArrowLeft color={theme.colors.onSurface} size={24} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{list.name}</Text>
        <Pressable onPress={deleteList} testID="delete-list-btn">
          <Trash2 color={theme.colors.error} size={22} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <View style={styles.stat}><Text style={styles.statVal}>{stats.pending}</Text><Text style={styles.statLbl}>Pendientes</Text></View>
            <View style={styles.stat}><Text style={[styles.statVal, { color: theme.colors.success }]}>{stats.bought}</Text><Text style={styles.statLbl}>Comprados</Text></View>
            <View style={styles.stat}><Text style={[styles.statVal, { color: theme.colors.error }]}>{stats.unavailable}</Text><Text style={styles.statLbl}>No había</Text></View>
          </View>
          <View style={styles.spentRow}>
            <Text style={styles.spentLbl}>Gastado</Text>
            <Text style={styles.spentVal}>{formatMoney(stats.spent, list.currency)}</Text>
          </View>
        </View>

        {list.items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <ShoppingCart color={theme.colors.muted} size={32} />
            </View>
            <Text style={styles.emptyTitle}>Lista vacía</Text>
            <Text style={styles.emptySub}>Agrega productos para empezar</Text>
          </View>
        ) : (
          <View style={styles.items}>
            {list.items.map((it) => (
              <ListItemRow
                key={it.id}
                item={it}
                currency={list.currency}
                onToggleBought={() => {
                  if (it.status === "bought") {
                    updateItem(it.id, { status: "pending" });
                  } else {
                    setBuyItem(it);
                  }
                }}
                onToggleUnavailable={() => updateItem(it.id, { status: it.status === "unavailable" ? "pending" : "unavailable" })}
                onDelete={() => deleteItem(it.id)}
                onEditBought={() => setBuyItem(it)}
              />
            ))}
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <Pressable
        testID="add-item-fab"
        onPress={() => setAddOpen(true)}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
      >
        <Plus color="#fff" size={26} />
      </Pressable>

      <AddItemSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        listId={list.id}
        onAdded={(updated) => { setList(updated); }}
      />

      <MarkBoughtSheet
        item={buyItem}
        markets={markets}
        currency={list.currency}
        currencySymbol={currInfo.symbol}
        onClose={() => setBuyItem(null)}
        onSave={async (patch) => {
          if (!buyItem) return;
          await updateItem(buyItem.id, { ...patch, status: "bought" });
          setBuyItem(null);
        }}
      />
    </SafeAreaView>
  );
}

// -----------------------------
function ListItemRow({ item, currency, onToggleBought, onToggleUnavailable, onDelete, onEditBought }: any) {
  const isBought = item.status === "bought";
  const isUnavail = item.status === "unavailable";
  const catColor = CATEGORY_COLORS[item.category] || "#6B7280";
  return (
    <View style={[styles.itemCard, isBought && styles.itemBought, isUnavail && styles.itemUnavail]} testID={`item-row-${item.id}`}>
      <Pressable onPress={onToggleBought} style={[styles.checkbox, isBought && styles.checkboxOn]} testID={`toggle-bought-${item.id}`}>
        {isBought && <Check color="#fff" size={16} strokeWidth={3} />}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, isBought && styles.strike, isUnavail && styles.strike]}>
          {item.name}
        </Text>
        <View style={styles.itemMeta}>
          <View style={[styles.catDot, { backgroundColor: catColor }]} />
          <Text style={styles.itemMetaText}>
            {item.quantity} {item.unit === "kg" ? "kg" : "un"} · {CATEGORY_LABEL[item.category] || "Otros"}
          </Text>
        </View>
        {isBought && item.paid_price != null && (
          <Pressable onPress={onEditBought} style={styles.paidPill}>
            <Store color={theme.colors.brand} size={12} />
            <Text style={styles.paidText}>
              {item.paid_market_name || "Sin mercado"} · {formatMoney(item.paid_price * (item.quantity || 1), currency)}
            </Text>
            <Edit3 color={theme.colors.brand} size={12} />
          </Pressable>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onToggleUnavailable} style={[styles.actBtn, isUnavail && { backgroundColor: theme.colors.error + "22" }]} testID={`toggle-unavailable-${item.id}`}>
          <PackageX color={isUnavail ? theme.colors.error : theme.colors.muted} size={18} />
        </Pressable>
        <Pressable onPress={onDelete} style={styles.actBtn} testID={`delete-item-${item.id}`}>
          <Trash2 color={theme.colors.muted} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

// -----------------------------
function AddItemSheet({ visible, onClose, listId, onAdded }: any) {
  const [tab, setTab] = useState<"manual" | "history">("manual");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState<"un" | "kg">("un");
  const [category, setCategory] = useState("otros");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HistoryProduct[]>([]);
  const [search, setSearch] = useState("");
  const [loadingHist, setLoadingHist] = useState(false);

  useEffect(() => {
    if (visible && tab === "history") {
      setLoadingHist(true);
      api<HistoryProduct[]>(`/products/history${search ? `?q=${encodeURIComponent(search)}` : ""}`)
        .then((r) => setHistory(r)).catch(() => {})
        .finally(() => setLoadingHist(false));
    }
  }, [visible, tab, search]);

  useEffect(() => {
    if (!visible) {
      setTab("manual"); setName(""); setQty("1"); setUnit("un"); setCategory("otros"); setSearch("");
    }
  }, [visible]);

  const addManual = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await api(`/shopping-lists/${listId}/items`, {
        method: "POST",
        body: { name: name.trim(), quantity: parseFloat(qty) || 1, unit, category },
      });
      onAdded(updated);
      onClose();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const addFromHistory = async (p: HistoryProduct) => {
    setSaving(true);
    try {
      const updated = await api(`/shopping-lists/${listId}/items`, {
        method: "POST",
        body: { name: p.name, quantity: 1, unit: p.unit, category: p.category },
      });
      onAdded(updated);
      onClose();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: "88%" }]} testID="add-item-sheet">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Agregar producto</Text>
            <Pressable onPress={onClose}><X color={theme.colors.muted} size={22} /></Pressable>
          </View>
          <View style={styles.tabsRow}>
            <Pressable onPress={() => setTab("manual")} style={[styles.tabChip, tab === "manual" && styles.tabChipOn]} testID="tab-manual">
              <Text style={[styles.tabText, tab === "manual" && styles.tabTextOn]}>Manual</Text>
            </Pressable>
            <Pressable onPress={() => setTab("history")} style={[styles.tabChip, tab === "history" && styles.tabChipOn]} testID="tab-history">
              <Text style={[styles.tabText, tab === "history" && styles.tabTextOn]}>De mis compras</Text>
            </Pressable>
          </View>

          {tab === "manual" ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.miniLabel}>Nombre</Text>
              <TextInput
                testID="manual-name-input"
                value={name}
                onChangeText={setName}
                placeholder="Ej: Leche, Arroz, Manzanas"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Cantidad</Text>
                  <TextInput
                    testID="manual-qty-input"
                    value={qty}
                    onChangeText={(v) => setQty(v.replace(",", "."))}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Unidad</Text>
                  <View style={styles.unitRow}>
                    {(["un", "kg"] as const).map((u) => (
                      <Pressable key={u} onPress={() => setUnit(u)} style={[styles.unitChip, unit === u && styles.unitChipOn]} testID={`manual-unit-${u}`}>
                        <Text style={[styles.unitText, unit === u && styles.unitTextOn]}>{u === "un" ? "Un" : "Kg"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <Text style={[styles.miniLabel, { marginTop: 12 }]}>Categoría</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
                {CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    style={[styles.catChip, category === c && { borderColor: CATEGORY_COLORS[c], backgroundColor: CATEGORY_COLORS[c] + "22" }]}
                    testID={`manual-cat-${c}`}
                  >
                    <Text style={[styles.catText, category === c && { color: CATEGORY_COLORS[c], fontWeight: "700" }]}>
                      {CATEGORY_LABEL[c]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                testID="save-manual-item-btn"
                onPress={addManual}
                disabled={saving || !name.trim()}
                style={[styles.primary, (!name.trim() || saving) && { opacity: 0.5 }]}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Plus color="#fff" size={18} />
                    <Text style={styles.primaryText}>Agregar</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          ) : (
            <>
              <View style={styles.searchBox}>
                <Search color={theme.colors.muted} size={18} />
                <TextInput
                  testID="history-search-input"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar producto…"
                  placeholderTextColor={theme.colors.muted}
                  style={styles.searchInput}
                />
              </View>
              {loadingHist ? (
                <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 30 }} />
              ) : history.length === 0 ? (
                <View style={{ alignItems: "center", padding: 30 }}>
                  <RotateCcw color={theme.colors.muted} size={28} />
                  <Text style={{ color: theme.colors.muted, marginTop: 10, fontSize: 13, textAlign: "center" }}>
                    Aún no tienes productos en compras previas.{"\n"}Registra una compra primero para verlos acá.
                  </Text>
                </View>
              ) : (
                <ScrollView keyboardShouldPersistTaps="handled">
                  {history.map((p) => (
                    <Pressable
                      key={p.name}
                      onPress={() => addFromHistory(p)}
                      style={styles.histRow}
                      testID={`history-item-${p.name}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.histName}>{p.name}</Text>
                        <Text style={styles.histCat}>{CATEGORY_LABEL[p.category] || "Otros"}</Text>
                        <View style={styles.priceList}>
                          {p.prices.map((pr, idx) => (
                            <View key={pr.market_id || idx} style={[styles.pricePill, idx === 0 && p.prices.length > 1 && styles.pricePillBest]}>
                              {idx === 0 && p.prices.length > 1 && <Trophy color={theme.colors.success} size={11} />}
                              <Text style={[styles.priceMkt, idx === 0 && p.prices.length > 1 && { color: theme.colors.success }]}>
                                {pr.market_name}
                              </Text>
                              <Text style={[styles.priceVal, idx === 0 && p.prices.length > 1 && { color: theme.colors.success }]}>
                                {formatMoney(pr.price, pr.currency)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      <Plus color={theme.colors.brand} size={22} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// -----------------------------
function MarkBoughtSheet({ item, markets, currency, currencySymbol, onClose, onSave }: any) {
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [marketId, setMarketId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setPrice(item.paid_price != null ? String(item.paid_price) : "");
      setQty(String(item.quantity));
      setMarketId(item.paid_market_id || null);
    }
  }, [item]);

  if (!item) return null;

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave({
        paid_price: parseFloat(price) || 0,
        quantity: parseFloat(qty) || 1,
        paid_market_id: marketId || undefined,
      });
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet} testID="mark-bought-sheet">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Marcar como comprado</Text>
            <Pressable onPress={onClose}><X color={theme.colors.muted} size={22} /></Pressable>
          </View>
          <Text style={styles.itemNameBig}>{item.name}</Text>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.miniLabel}>Cantidad</Text>
              <TextInput
                testID="buy-qty-input"
                value={qty}
                onChangeText={(v) => setQty(v.replace(",", "."))}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1.3 }}>
              <Text style={styles.miniLabel}>Precio unit. ({currencySymbol})</Text>
              <TextInput
                testID="buy-price-input"
                value={price}
                onChangeText={(v) => setPrice(v.replace(",", "."))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                autoFocus
              />
            </View>
          </View>

          <Text style={[styles.miniLabel, { marginTop: 12 }]}>Mercado</Text>
          {markets.length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>Agrega mercados en la pestaña Mercados</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
              {markets.map((m: Market) => (
                <Pressable
                  key={m.id}
                  onPress={() => setMarketId(m.id)}
                  style={[styles.mktChip, marketId === m.id && { borderColor: m.color, backgroundColor: m.color + "22" }]}
                  testID={`buy-market-${m.id}`}
                >
                  <View style={[styles.mktDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.mktText, marketId === m.id && { color: m.color, fontWeight: "700" }]}>{m.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {parseFloat(price) > 0 && parseFloat(qty) > 0 && (
            <Text style={styles.totalPreview} testID="buy-total-preview">
              Total: {formatMoney(parseFloat(price) * parseFloat(qty), currency)}
            </Text>
          )}

          <Pressable
            testID="save-bought-btn"
            onPress={doSave}
            disabled={saving || !(parseFloat(price) > 0)}
            style={[styles.primary, !(parseFloat(price) > 0) && { opacity: 0.5 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Check color="#fff" size={18} />
                <Text style={styles.primaryText}>Confirmar compra</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { flex: 1, fontSize: 20, fontWeight: "800", color: theme.colors.onSurface, textAlign: "center" },
  scroll: { padding: theme.spacing.lg, paddingTop: 0 },
  summary: { backgroundColor: theme.colors.surfaceInverse, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  stat: { flex: 1 },
  statVal: { fontSize: 24, fontWeight: "800", color: "#fff" },
  statLbl: { fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2, textTransform: "uppercase" },
  spentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", paddingTop: 12 },
  spentLbl: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  spentVal: { color: "#fff", fontSize: 22, fontWeight: "800" },
  items: { gap: 8 },
  itemCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, minHeight: 64 },
  itemBought: { backgroundColor: theme.colors.brandTertiary, borderColor: theme.colors.brandSecondary },
  itemUnavail: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", opacity: 0.85 },
  checkbox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: theme.colors.borderStrong, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  itemName: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  strike: { textDecorationLine: "line-through", color: theme.colors.muted },
  itemMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  itemMetaText: { fontSize: 12, color: theme.colors.muted },
  paidPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.colors.brandSecondary, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.pill, marginTop: 6 },
  paidText: { fontSize: 11, color: theme.colors.onBrandSecondary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 4 },
  actBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceSecondary },
  empty: { alignItems: "center", padding: theme.spacing.xxl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  emptySub: { fontSize: 13, color: theme.colors.muted, marginTop: 4 },
  fab: { position: "absolute", bottom: theme.spacing.lg, right: theme.spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 40 },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.md },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface },
  miniLabel: { fontSize: 11, fontWeight: "700", color: theme.colors.muted, textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 },
  input: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, padding: 12, fontSize: 15, color: theme.colors.onSurface, borderWidth: 1, borderColor: theme.colors.border },
  tabsRow: { flexDirection: "row", gap: 8, marginBottom: theme.spacing.md },
  tabChip: { flex: 1, paddingVertical: 10, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", backgroundColor: theme.colors.surfaceSecondary },
  tabChipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  tabText: { fontSize: 13, fontWeight: "600", color: theme.colors.onSurface },
  tabTextOn: { color: "#fff" },
  unitRow: { flexDirection: "row", backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, padding: 2, borderWidth: 1, borderColor: theme.colors.border },
  unitChip: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  unitChipOn: { backgroundColor: theme.colors.brand },
  unitText: { fontSize: 13, fontWeight: "600", color: theme.colors.onSurfaceSecondary },
  unitTextOn: { color: "#fff" },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, flexShrink: 0 },
  catText: { fontSize: 12, color: theme.colors.onSurface },
  primary: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.xl },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10 },
  searchInput: { flex: 1, height: 44, color: theme.colors.onSurface },
  histRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  histName: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  histCat: { fontSize: 11, color: theme.colors.muted, marginTop: 2 },
  priceList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pricePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border },
  pricePillBest: { backgroundColor: theme.colors.brandTertiary, borderColor: theme.colors.brandSecondary },
  priceMkt: { fontSize: 11, color: theme.colors.onSurface, fontWeight: "600" },
  priceVal: { fontSize: 11, color: theme.colors.onSurface, fontWeight: "800" },
  itemNameBig: { fontSize: 20, fontWeight: "700", color: theme.colors.onSurface, marginBottom: 12 },
  mktChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, flexShrink: 0 },
  mktDot: { width: 8, height: 8, borderRadius: 4 },
  mktText: { fontSize: 13, color: theme.colors.onSurface, fontWeight: "500" },
  totalPreview: { textAlign: "right", marginTop: 12, fontSize: 14, fontWeight: "700", color: theme.colors.brand },
});
