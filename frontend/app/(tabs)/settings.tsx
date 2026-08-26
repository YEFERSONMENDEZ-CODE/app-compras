import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LogOut, ChevronRight, Check, DollarSign, User as UserIcon } from "lucide-react-native";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { DEFAULT_CURRENCIES } from "@/src/currency";

export default function SettingsScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [currencies, setCurrencies] = useState(DEFAULT_CURRENCIES);

  useEffect(() => {
    api<any[]>("/currencies").then((c) => setCurrencies(c as any)).catch(() => {});
  }, []);

  const setCurrency = async (code: string) => {
    try {
      await api("/auth/currency", { method: "PUT", body: { currency: code } });
      await refreshUser();
      setModalOpen(false);
    } catch {}
  };

  const active = currencies.find((c) => c.code === user?.preferred_currency) || currencies[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="settings-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Ajustes</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <UserIcon color="#fff" size={24} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name || "-"}</Text>
            <Text style={styles.email}>{user?.email || "-"}</Text>
          </View>
        </View>

        <Text style={styles.section}>Preferencias</Text>
        <View style={styles.list}>
          <Pressable style={styles.row} onPress={() => setModalOpen(true)} testID="currency-picker-row">
            <View style={styles.iconBox}>
              <DollarSign color={theme.colors.brand} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Moneda</Text>
              <Text style={styles.rowSub}>{active?.name}</Text>
            </View>
            <Text style={styles.rowValue}>{active?.symbol} {active?.code}</Text>
            <ChevronRight color={theme.colors.muted} size={18} />
          </Pressable>
        </View>

        <View style={{ height: 20 }} />
        <Pressable style={styles.logout} onPress={signOut} testID="logout-btn">
          <LogOut color={theme.colors.error} size={20} />
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>Elegir moneda</Text>
            {currencies.map((c) => (
              <Pressable
                key={c.code}
                onPress={() => setCurrency(c.code)}
                style={styles.currRow}
                testID={`currency-option-${c.code}`}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currName}>{c.name}</Text>
                  <Text style={styles.currCode}>{c.code} · {c.symbol}</Text>
                </View>
                {user?.preferred_currency === c.code && <Check color={theme.colors.brand} size={22} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceSecondary },
  header: { padding: theme.spacing.lg },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.onSurface },
  scroll: { padding: theme.spacing.lg, paddingTop: 0 },
  profileCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, flexDirection: "row", gap: theme.spacing.md, alignItems: "center", marginBottom: theme.spacing.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  email: { fontSize: 13, color: theme.colors.muted, marginTop: 2 },
  section: { fontSize: 12, fontWeight: "700", color: theme.colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: theme.spacing.sm },
  list: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },
  row: { flexDirection: "row", alignItems: "center", padding: theme.spacing.md, minHeight: 64, gap: theme.spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  rowSub: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  rowValue: { fontSize: 13, fontWeight: "700", color: theme.colors.onSurface, marginRight: 8 },
  logout: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  logoutText: { color: theme.colors.error, fontWeight: "700", fontSize: 15 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 40 },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface, marginBottom: theme.spacing.md },
  currRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  flag: { fontSize: 28 },
  currName: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  currCode: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
});
