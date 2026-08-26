import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Store, Plus, Trash2, X, Edit3 } from "lucide-react-native";
import { theme } from "@/src/theme";
import { api } from "@/src/api";

type Market = { id: string; name: string; color: string; icon: string };

const COLOR_CHOICES = ["#059669", "#F59E0B", "#EF4444", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#D97706"];

export default function MarketsScreen() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Market | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#059669");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api<Market[]>("/markets");
      setMarkets(rows);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => { setEditing(null); setName(""); setColor("#059669"); setModalOpen(true); };
  const openEdit = (m: Market) => { setEditing(m); setName(m.name); setColor(m.color); setModalOpen(true); };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api(`/markets/${editing.id}`, { method: "PUT", body: { name: name.trim(), color } });
      } else {
        await api(`/markets`, { method: "POST", body: { name: name.trim(), color } });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      console.warn(e);
    } finally { setSaving(false); }
  };

  const remove = async (m: Market) => {
    try { await api(`/markets/${m.id}`, { method: "DELETE" }); await load(); } catch (e) {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="markets-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Mercados</Text>
        <Pressable testID="add-market-btn" onPress={openNew} style={styles.addBtn}>
          <Plus color="#fff" size={20} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
        ) : markets.length === 0 ? (
          <View style={styles.empty} testID="empty-markets">
            <View style={styles.emptyIcon}>
              <Store color={theme.colors.muted} size={32} />
            </View>
            <Text style={styles.emptyTitle}>Agrega tu primer mercado</Text>
            <Text style={styles.emptySub}>Los supermercados que más visitas</Text>
            <Pressable testID="empty-add-market-btn" onPress={openNew} style={styles.emptyBtn}>
              <Plus color="#fff" size={18} />
              <Text style={styles.emptyBtnText}>Agregar mercado</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {markets.map((m) => (
              <View key={m.id} style={styles.row} testID={`market-row-${m.id}`}>
                <View style={[styles.iconBox, { backgroundColor: m.color + "22" }]}>
                  <Store color={m.color} size={20} />
                </View>
                <Text style={styles.name}>{m.name}</Text>
                <Pressable onPress={() => openEdit(m)} style={styles.iconBtn} testID={`edit-market-${m.id}`}>
                  <Edit3 color={theme.colors.muted} size={18} />
                </Pressable>
                <Pressable onPress={() => remove(m)} style={styles.iconBtn} testID={`delete-market-${m.id}`}>
                  <Trash2 color={theme.colors.error} size={18} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalOpen(false)} />
          <View style={styles.sheet} testID="market-form-sheet">
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{editing ? "Editar mercado" : "Nuevo mercado"}</Text>
              <Pressable onPress={() => setModalOpen(false)}>
                <X color={theme.colors.muted} size={22} />
              </Pressable>
            </View>
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              testID="market-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Ej: Superseis, Stock, Real"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              autoFocus
            />
            <Text style={styles.label}>Color</Text>
            <View style={styles.colorRow}>
              {COLOR_CHOICES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorSel]}
                  testID={`market-color-${c}`}
                />
              ))}
            </View>
            <Pressable
              testID="save-market-btn"
              onPress={save}
              disabled={saving || !name.trim()}
              style={[styles.primary, (!name.trim() || saving) && { opacity: 0.5 }]}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Guardar</Text>}
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
  row: { flexDirection: "row", alignItems: "center", padding: theme.spacing.md, minHeight: 64, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, gap: theme.spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  iconBtn: { padding: 8 },
  empty: { alignItems: "center", padding: theme.spacing.xxl, marginTop: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  emptySub: { fontSize: 13, color: theme.colors.muted, marginTop: 4, marginBottom: theme.spacing.lg },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.colors.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.pill },
  emptyBtnText: { color: "#fff", fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 32 },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface },
  label: { fontSize: 12, fontWeight: "600", color: theme.colors.muted, marginBottom: 6, marginTop: theme.spacing.md, textTransform: "uppercase" },
  input: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: 14, fontSize: 16, color: theme.colors.onSurface, borderWidth: 1, borderColor: theme.colors.border },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  colorDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: "transparent" },
  colorSel: { borderColor: theme.colors.onSurface },
  primary: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.xl },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
