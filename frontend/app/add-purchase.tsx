import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { X, Plus, Trash2, ChevronDown } from "lucide-react-native";
import { theme, CATEGORIES, CATEGORY_LABEL, CATEGORY_COLORS } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { currencyByCode } from "@/src/currency";

type Item = { name: string; quantity: string; unit: "un" | "kg"; price: string; category: string };
type Market = { id: string; name: string; color: string };

export default function AddPurchase() {
  const router = useRouter();
  const params = useLocalSearchParams<{ preload?: string; purchaseId?: string }>();
  const { user } = useAuth();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([{ name: "", quantity: "1", unit: "un", price: "", category: "otros" }]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currency, setCurrency] = useState(user?.preferred_currency || "PYG");
  const isEditing = !!params.purchaseId;
  const currInfo = currencyByCode(currency);

  const load = useCallback(async () => {
    try {
      const rows = await api<Market[]>("/markets");
      setMarkets(rows);
      if (rows.length && !selectedMarket) setSelectedMarket(rows[0].id);
    } catch {}
  }, [selectedMarket]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (params.purchaseId) {
      (async () => {
        try {
          const p: any = await api(`/purchases/${params.purchaseId}`);
          setSelectedMarket(p.market_id);
          setCurrency(p.currency);
          setItems(
            (p.items || []).map((it: any) => ({
              name: String(it.name || ""),
              quantity: String(it.quantity ?? 1),
              unit: it.unit === "kg" ? "kg" : "un",
              price: String(it.price ?? ""),
              category: it.category || "otros",
            }))
          );
        } catch (e) { console.warn(e); }
      })();
      return;
    }
    if (params.preload) {
      try {
        const data = JSON.parse(params.preload as string);
        if (data.currency) setCurrency(data.currency);
        if (Array.isArray(data.items) && data.items.length) {
          setItems(
            data.items.map((it: any) => ({
              name: String(it.name || ""),
              quantity: String(it.quantity ?? 1),
              unit: it.unit === "kg" ? "kg" : "un",
              price: String(it.price ?? ""),
              category: it.category || "otros",
            }))
          );
        }
      } catch {}
    }
  }, [params.preload, params.purchaseId]);

  const updateItem = (idx: number, k: keyof Item, v: string) => {
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  };
  const addItem = () => setItems((p) => [...p, { name: "", quantity: "1", unit: "un", price: "", category: "otros" }]);
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));

  const total = items.reduce((s, it) => {
    const q = parseFloat(it.quantity) || 1;
    const p = parseFloat(it.price) || 0;
    return s + p * q;
  }, 0);

  const save = async () => {
    if (!selectedMarket) return;
    const valid = items.filter((i) => i.name.trim() && parseFloat(i.price) > 0);
    if (!valid.length) return;
    setSaving(true);
    try {
      const body = {
        market_id: selectedMarket,
        currency,
        items: valid.map((it) => ({
          name: it.name.trim(),
          quantity: parseFloat(it.quantity) || 1,
          unit: it.unit,
          price: parseFloat(it.price),
          category: it.category,
        })),
      };
      if (isEditing) {
        await api(`/purchases/${params.purchaseId}`, { method: "PUT", body });
      } else {
        await api("/purchases", { method: "POST", body });
      }
      router.back();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!params.purchaseId) return;
    setDeleting(true);
    try {
      await api(`/purchases/${params.purchaseId}`, { method: "DELETE" });
      router.back();
    } catch (e) { console.warn(e); }
    finally { setDeleting(false); }
  };

  const selectedMarketObj = markets.find((m) => m.id === selectedMarket);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="add-purchase-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="close-add-purchase">
          <X color={theme.colors.onSurface} size={24} />
        </Pressable>
        <Text style={styles.title}>{isEditing ? "Editar compra" : "Nueva compra"}</Text>
        {isEditing ? (
          <Pressable onPress={remove} disabled={deleting} testID="delete-purchase-btn">
            {deleting ? <ActivityIndicator color={theme.colors.error} /> : <Trash2 color={theme.colors.error} size={22} />}
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={20}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Mercado</Text>
          <Pressable style={styles.select} onPress={() => setMarketOpen((o) => !o)} testID="market-selector">
            <Text style={styles.selectText}>
              {selectedMarketObj?.name || (markets.length ? "Elegir mercado" : "Agrega un mercado primero")}
            </Text>
            <ChevronDown color={theme.colors.muted} size={18} />
          </Pressable>
          {marketOpen && (
            <View style={styles.dropdown}>
              {markets.length === 0 ? (
                <Text style={styles.hint}>Ve a Mercados y agrega uno</Text>
              ) : markets.map((m) => (
                <Pressable key={m.id} onPress={() => { setSelectedMarket(m.id); setMarketOpen(false); }} style={styles.dropRow} testID={`market-opt-${m.id}`}>
                  <View style={[styles.mDot, { backgroundColor: m.color }]} />
                  <Text style={styles.dropText}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.label}>Moneda</Text>
          <View style={styles.currRow}>
            {["PYG", "USD", "EUR", "BRL", "ARS"].map((c) => (
              <Pressable
                key={c}
                onPress={() => setCurrency(c)}
                style={[styles.chip, currency === c && styles.chipActive]}
                testID={`currency-chip-${c}`}
              >
                <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Productos</Text>
          {items.map((it, idx) => (
            <View key={idx} style={styles.itemCard} testID={`item-card-${idx}`}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNo}>#{idx + 1}</Text>
                {items.length > 1 && (
                  <Pressable onPress={() => removeItem(idx)} testID={`remove-item-${idx}`}>
                    <Trash2 color={theme.colors.error} size={16} />
                  </Pressable>
                )}
              </View>
              <TextInput
                testID={`item-name-${idx}`}
                value={it.name}
                onChangeText={(v) => updateItem(idx, "name", v)}
                placeholder="Nombre del producto"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <View style={styles.rowInputs}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Cantidad</Text>
                  <TextInput
                    testID={`item-qty-${idx}`}
                    value={it.quantity}
                    onChangeText={(v) => updateItem(idx, "quantity", v.replace(",", "."))}
                    placeholder="1"
                    keyboardType="decimal-pad"
                    placeholderTextColor={theme.colors.muted}
                    style={styles.smallInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Unidad</Text>
                  <View style={styles.unitRow}>
                    {(["un", "kg"] as const).map((u) => (
                      <Pressable
                        key={u}
                        onPress={() => updateItem(idx, "unit", u)}
                        style={[styles.unitChip, it.unit === u && styles.unitChipActive]}
                        testID={`item-unit-${idx}-${u}`}
                      >
                        <Text style={[styles.unitText, it.unit === u && styles.unitTextActive]}>
                          {u === "un" ? "Un" : "Kg"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={{ flex: 1.3 }}>
                  <Text style={styles.miniLabel}>Precio unit.</Text>
                  <TextInput
                    testID={`item-price-${idx}`}
                    value={it.price}
                    onChangeText={(v) => updateItem(idx, "price", v.replace(",", "."))}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    placeholderTextColor={theme.colors.muted}
                    style={styles.smallInput}
                  />
                </View>
              </View>
              {(() => {
                const q = parseFloat(it.quantity) || 0;
                const p = parseFloat(it.price) || 0;
                if (q > 1 && p > 0) {
                  return (
                    <Text style={styles.subtotal} testID={`item-subtotal-${idx}`}>
                      Subtotal: {currInfo.symbol} {(p * q).toLocaleString("es-PY", { minimumFractionDigits: currInfo.decimals, maximumFractionDigits: currInfo.decimals })}
                    </Text>
                  );
                }
                return null;
              })()}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 8 }}>
                {CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => updateItem(idx, "category", c)}
                    style={[styles.catChip, { borderColor: it.category === c ? CATEGORY_COLORS[c] : theme.colors.border }, it.category === c && { backgroundColor: CATEGORY_COLORS[c] + "22" }]}
                    testID={`item-cat-${idx}-${c}`}
                  >
                    <Text style={[styles.catText, it.category === c && { color: CATEGORY_COLORS[c], fontWeight: "700" }]}>
                      {CATEGORY_LABEL[c]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}

          <Pressable onPress={addItem} style={styles.addItem} testID="add-item-btn">
            <Plus color={theme.colors.brand} size={18} />
            <Text style={styles.addItemText}>Agregar producto</Text>
          </Pressable>
          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {currInfo.symbol} {total.toLocaleString("es-PY", { minimumFractionDigits: currInfo.decimals, maximumFractionDigits: currInfo.decimals })}
            </Text>
          </View>
          <Pressable
            onPress={save}
            disabled={saving || !selectedMarket}
            style={[styles.saveBtn, (!selectedMarket || saving) && { opacity: 0.5 }]}
            testID="save-purchase-btn"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Guardar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  title: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface },
  scroll: { padding: theme.spacing.lg, paddingTop: 0 },
  label: { fontSize: 12, fontWeight: "700", color: theme.colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  select: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText: { fontSize: 15, color: theme.colors.onSurface, fontWeight: "500" },
  dropdown: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, marginTop: 4, overflow: "hidden" },
  dropRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  dropText: { fontSize: 15, color: theme.colors.onSurface },
  hint: { padding: 14, color: theme.colors.muted, fontSize: 13 },
  mDot: { width: 10, height: 10, borderRadius: 5 },
  currRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.onSurface, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },
  itemCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.md },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  itemNo: { fontSize: 11, fontWeight: "700", color: theme.colors.muted },
  input: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, padding: 12, fontSize: 15, color: theme.colors.onSurface, borderWidth: 1, borderColor: theme.colors.border },
  rowInputs: { flexDirection: "row", gap: 8, marginTop: 10 },
  miniLabel: { fontSize: 10, fontWeight: "700", color: theme.colors.muted, textTransform: "uppercase", marginBottom: 4 },
  smallInput: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: theme.colors.onSurface, borderWidth: 1, borderColor: theme.colors.border },
  unitRow: { flexDirection: "row", backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10, padding: 2, borderWidth: 1, borderColor: theme.colors.border },
  unitChip: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  unitChipActive: { backgroundColor: theme.colors.brand },
  unitText: { fontSize: 13, fontWeight: "600", color: theme.colors.onSurfaceSecondary },
  unitTextActive: { color: "#fff" },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1, backgroundColor: theme.colors.surface, flexShrink: 0 },
  catText: { fontSize: 12, color: theme.colors.onSurface },
  subtotal: { marginTop: 8, fontSize: 12, color: theme.colors.brand, fontWeight: "700", textAlign: "right" },
  addItem: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.brand, borderStyle: "dashed", backgroundColor: theme.colors.brandTertiary },
  addItemText: { color: theme.colors.brand, fontWeight: "700" },
  footer: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface },
  totalLabel: { fontSize: 11, color: theme.colors.muted, fontWeight: "600", textTransform: "uppercase" },
  totalValue: { fontSize: 22, fontWeight: "800", color: theme.colors.onSurface },
  saveBtn: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 28, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
