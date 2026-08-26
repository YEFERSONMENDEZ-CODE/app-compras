import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Plus, ListChecks, ChevronRight, Check, X, ShoppingCart } from "lucide-react-native";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type ShoppingList = {
  id: string;
  name: string;
  currency: string;
  created_at: string;
  items: any[];
};

export default function ListsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api<ShoppingList[]>("/shopping-lists");
      setLists(rows);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createList = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const list = await api<ShoppingList>("/shopping-lists", {
        method: "POST",
        body: { name: newName.trim(), currency: user?.preferred_currency || "PYG" },
      });
      setModalOpen(false);
      setNewName("");
      router.push(`/shopping-list/${list.id}`);
      load();
    } catch (e) { console.warn(e); }
    finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="lists-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Listas de compra</Text>
        <Pressable testID="add-list-btn" onPress={() => setModalOpen(true)} style={styles.addBtn}>
          <Plus color="#fff" size={20} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
        ) : lists.length === 0 ? (
          <View style={styles.empty} testID="empty-lists">
            <View style={styles.emptyIcon}>
              <ShoppingCart color={theme.colors.muted} size={32} />
            </View>
            <Text style={styles.emptyTitle}>Crea tu primera lista</Text>
            <Text style={styles.emptySub}>Planifica tus compras y compara precios entre mercados</Text>
            <Pressable testID="empty-add-list-btn" onPress={() => setModalOpen(true)} style={styles.emptyBtn}>
              <Plus color="#fff" size={18} />
              <Text style={styles.emptyBtnText}>Nueva lista</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {lists.map((l) => {
              const total = l.items.length;
              const bought = l.items.filter((i) => i.status === "bought").length;
              const spent = l.items.filter((i) => i.status === "bought").reduce((s, i) => s + (i.paid_price || 0) * (i.quantity || 1), 0);
              return (
                <Pressable
                  key={l.id}
                  testID={`list-row-${l.id}`}
                  onPress={() => router.push(`/shopping-list/${l.id}`)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.rowIcon}>
                    <ListChecks color={theme.colors.brand} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{l.name}</Text>
                    <Text style={styles.rowSub}>
                      {bought}/{total} · {new Date(l.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                    </Text>
                  </View>
                  {spent > 0 ? (
                    <Text style={styles.rowAmount}>{l.currency} {spent.toLocaleString("es-PY", { maximumFractionDigits: 0 })}</Text>
                  ) : null}
                  <ChevronRight color={theme.colors.muted} size={18} />
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Nueva lista</Text>
              <Pressable onPress={() => setModalOpen(false)}>
                <X color={theme.colors.muted} size={22} />
              </Pressable>
            </View>
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              testID="new-list-name-input"
              value={newName}
              onChangeText={setNewName}
              placeholder="Ej: Compra del mes, Fiesta, Semana"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              autoFocus
            />
            <Pressable
              testID="create-list-btn"
              onPress={createList}
              disabled={creating || !newName.trim()}
              style={[styles.primary, (!newName.trim() || creating) && { opacity: 0.5 }]}
            >
              {creating ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Check color="#fff" size={18} />
                  <Text style={styles.primaryText}>Crear lista</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.lg, paddingBottom: theme.spacing.md },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.onSurface },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  scroll: { padding: theme.spacing.lg, paddingTop: 0 },
  list: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },
  row: { flexDirection: "row", alignItems: "center", padding: theme.spacing.md, minHeight: 64, gap: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  rowSub: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: "700", color: theme.colors.brand },
  empty: { alignItems: "center", padding: theme.spacing.xxl, marginTop: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  emptySub: { fontSize: 13, color: theme.colors.muted, marginTop: 4, marginBottom: theme.spacing.lg, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.colors.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.pill },
  emptyBtnText: { color: "#fff", fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 40 },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface },
  label: { fontSize: 12, fontWeight: "700", color: theme.colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: 14, fontSize: 16, color: theme.colors.onSurface, borderWidth: 1, borderColor: theme.colors.border },
  primary: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.xl },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
