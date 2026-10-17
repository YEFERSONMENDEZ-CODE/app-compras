import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LogOut, ChevronRight, Check, DollarSign, User as UserIcon, Users, UserPlus, Home, Trash2, X } from "lucide-react-native";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { DEFAULT_CURRENCIES } from "@/src/currency";
import {
  acceptHouseholdInvitation,
  cancelHouseholdInvitation,
  createHousehold,
  getHousehold,
  HouseholdState,
  inviteToHousehold,
  leaveHousehold,
  removeHouseholdMember,
} from "@/src/household";

export default function SettingsScreen() {
  const { user, signOut, refreshUser, mode, syncError } = useAuth();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [currencies, setCurrencies] = useState(DEFAULT_CURRENCIES);
  const [household, setHousehold] = useState<HouseholdState | null>(null);
  const [householdLoading, setHouseholdLoading] = useState(false);
  const [householdError, setHouseholdError] = useState<string | null>(null);
  const [householdModal, setHouseholdModal] = useState<"create" | "invite" | null>(null);
  const [householdName, setHouseholdName] = useState("Mi hogar");
  const [inviteEmail, setInviteEmail] = useState("");
  const [householdBusy, setHouseholdBusy] = useState(false);

  const loadHousehold = useCallback(async () => {
    if (mode !== "authenticated") return;
    setHouseholdLoading(true);
    setHouseholdError(null);
    try {
      setHousehold(await getHousehold());
    } catch (error) {
      setHouseholdError(error instanceof Error ? error.message : "No se pudo cargar el espacio familiar");
    } finally {
      setHouseholdLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    api<any[]>("/currencies").then((c) => setCurrencies(c as any)).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void loadHousehold(); }, 0);
    return () => clearTimeout(timer);
  }, [loadHousehold]);

  const runHouseholdAction = async (action: () => Promise<HouseholdState | any>) => {
    setHouseholdBusy(true);
    setHouseholdError(null);
    try {
      const result = await action();
      if (result?.household !== undefined) setHousehold(result);
      setHouseholdModal(null);
      setInviteEmail("");
    } catch (error) {
      setHouseholdError(error instanceof Error ? error.message : "No se pudo completar la operación");
    } finally {
      setHouseholdBusy(false);
    }
  };

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
        {mode === "guest" && (
          <View style={styles.syncCard}>
            <Text style={styles.syncTitle}>Usás la aplicación como invitado</Text>
            <Text style={styles.syncText}>Tus listas y compras se guardan en este dispositivo. Iniciá sesión para respaldarlas y sincronizarlas.</Text>
            <Pressable style={styles.loginButton} onPress={() => router.push("/login")} testID="login-btn">
              <Text style={styles.loginButtonText}>Iniciar sesión o crear cuenta</Text>
            </Pressable>
          </View>
        )}
        {mode === "syncing" && <Text style={styles.syncStatus}>Sincronizando tus datos locales...</Text>}
        {syncError && <Text style={styles.syncError}>{syncError}</Text>}

        {mode === "authenticated" && (
          <>
            <Text style={styles.section}>Familia</Text>
            <View style={styles.familyCard}>
              <View style={styles.familyHeader}>
                <View style={styles.familyIcon}><Users color={theme.colors.brand} size={21} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Espacio familiar</Text>
                  <Text style={styles.rowSub}>Compartí listas, compras e historial</Text>
                </View>
                {householdLoading && <ActivityIndicator color={theme.colors.brand} />}
              </View>
              {householdError && <Text style={styles.syncError}>{householdError}</Text>}
              {!householdLoading && !household?.household && household?.pending_invitations.map((invitation) => (
                <View key={invitation.id} style={styles.invitation}>
                  <Text style={styles.rowTitle}>{invitation.household_name || "Invitación familiar"}</Text>
                  <Text style={styles.rowSub}>Invitado por {invitation.invited_by || "otro usuario"}</Text>
                  <Pressable
                    style={styles.primarySmall}
                    onPress={() => runHouseholdAction(() => acceptHouseholdInvitation(invitation.id))}
                    disabled={householdBusy}
                  >
                    <Text style={styles.primarySmallText}>Aceptar invitación</Text>
                  </Pressable>
                </View>
              ))}
              {!householdLoading && !household?.household && !household?.pending_invitations.length && (
                <>
                  <Text style={styles.syncText}>Creá un espacio para compartir tus datos con otra cuenta.</Text>
                  <Pressable style={styles.primaryButton} onPress={() => setHouseholdModal("create")}>
                    <Home color="#fff" size={18} />
                    <Text style={styles.primaryButtonText}>Crear espacio familiar</Text>
                  </Pressable>
                </>
              )}
              {household?.household && (
                <>
                  <Text style={styles.familyName}>{household.household.name}</Text>
                  {household.household.members.map((member) => (
                    <View key={member.user_id} style={styles.memberRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{member.name}</Text>
                        <Text style={styles.rowSub}>{member.email} · {member.role === "owner" ? "Propietario" : "Integrante"}</Text>
                      </View>
                      {member.user_id !== user?.user_id && household.household?.role === "owner" && (
                        <Pressable onPress={() => runHouseholdAction(() => removeHouseholdMember(member.user_id))} accessibilityLabel="Eliminar integrante">
                          <Trash2 color={theme.colors.error} size={19} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  {household.household.role === "owner" && household.household.pending_invitations.map((invitation) => (
                    <View key={invitation.id} style={styles.memberRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>Invitación pendiente</Text>
                        <Text style={styles.rowSub}>{invitation.email}</Text>
                      </View>
                      <Pressable onPress={() => runHouseholdAction(() => cancelHouseholdInvitation(invitation.id))} accessibilityLabel="Cancelar invitación">
                        <X color={theme.colors.muted} size={19} />
                      </Pressable>
                    </View>
                  ))}
                  {household.household.role === "owner" && household.household.members.length < 2 && (
                    <Pressable style={styles.primaryButton} onPress={() => setHouseholdModal("invite")}>
                      <UserPlus color="#fff" size={18} />
                      <Text style={styles.primaryButtonText}>Invitar por email</Text>
                    </Pressable>
                  )}
                  {household.household.role === "member" && (
                    <Pressable style={styles.secondaryButton} onPress={() => runHouseholdAction(leaveHousehold)}>
                      <Text style={styles.secondaryButtonText}>Salir del espacio</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          </>
        )}

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
      <Modal visible={householdModal !== null} transparent animationType="slide" onRequestClose={() => setHouseholdModal(null)}>
        <Pressable style={styles.modalBg} onPress={() => setHouseholdModal(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>{householdModal === "create" ? "Crear espacio familiar" : "Invitar integrante"}</Text>
            <Text style={styles.syncText}>
              {householdModal === "create" ? "El espacio compartirá tus listas, compras e historial con un integrante." : "La persona debe tener una cuenta creada con este email."}
            </Text>
            <TextInput
              style={styles.textInput}
              value={householdModal === "create" ? householdName : inviteEmail}
              onChangeText={householdModal === "create" ? setHouseholdName : setInviteEmail}
              placeholder={householdModal === "create" ? "Nombre del hogar" : "Email de la persona"}
              keyboardType={householdModal === "create" ? "default" : "email-address"}
              autoCapitalize="none"
              autoFocus
            />
            <Pressable
              style={styles.primaryButton}
              disabled={householdBusy || !(householdModal === "create" ? householdName.trim() : inviteEmail.trim())}
              onPress={() => householdModal === "create"
                ? runHouseholdAction(() => createHousehold(householdName.trim()))
                : runHouseholdAction(() => inviteToHousehold(inviteEmail.trim()))}
            >
              {householdBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{householdModal === "create" ? "Crear espacio" : "Enviar invitación"}</Text>}
            </Pressable>
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
  syncCard: { backgroundColor: theme.colors.brandTertiary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  syncTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.onSurface },
  syncText: { fontSize: 13, lineHeight: 19, color: theme.colors.onSurface, marginTop: 6 },
  loginButton: { backgroundColor: theme.colors.brand, borderRadius: 10, padding: 12, marginTop: 14, alignItems: "center" },
  loginButtonText: { color: "#fff", fontWeight: "700" },
  syncStatus: { color: theme.colors.brand, marginBottom: 14, fontWeight: "600" },
  syncError: { color: theme.colors.error, marginBottom: 14 },
  familyCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.lg },
  familyHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  familyIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  familyName: { fontSize: 18, fontWeight: "800", color: theme.colors.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  memberRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingVertical: theme.spacing.md },
  invitation: { borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: theme.spacing.md, marginTop: theme.spacing.md },
  primaryButton: { backgroundColor: theme.colors.brand, borderRadius: 10, minHeight: 44, paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  primarySmall: { backgroundColor: theme.colors.brand, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignSelf: "flex-start", marginTop: 10 },
  primarySmallText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.error, borderRadius: 10, minHeight: 44, marginTop: theme.spacing.md, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: theme.colors.error, fontWeight: "700" },
  textInput: { borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 10, minHeight: 48, paddingHorizontal: 14, marginTop: theme.spacing.md, color: theme.colors.onSurface, backgroundColor: theme.colors.surface },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 40 },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.onSurface, marginBottom: theme.spacing.md },
  currRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  flag: { fontSize: 28 },
  currName: { fontSize: 15, fontWeight: "600", color: theme.colors.onSurface },
  currCode: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
});
