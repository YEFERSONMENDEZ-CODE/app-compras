import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ImageBackground, TextInput, ScrollView, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShoppingBasket, Mail, Lock, User as UserIcon, Eye, EyeOff, ArrowLeft } from "lucide-react-native";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Mode = "welcome" | "email-login" | "email-register";

export default function LoginScreen() {
  const { signIn, signInWithEmail, registerWithEmail, signInWithApple, signInWithFacebook } = useAuth();
  const [mode, setMode] = useState<Mode>("welcome");
  const [loading, setLoading] = useState<string | null>(null);
  const [providers, setProviders] = useState<any>({ google: true, apple: true, email: true, facebook: false });
  const [appleAvailable, setAppleAvailable] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<any>("/auth/providers", { auth: false }).then(setProviders).catch(() => {});
    if (Platform.OS === "ios") {
      import("expo-apple-authentication").then((m) => {
        m.isAvailableAsync().then(setAppleAvailable).catch(() => {});
      }).catch(() => {});
    }
  }, []);

  const showError = (msg: string) => {
    setErr(msg);
    setTimeout(() => setErr(null), 4000);
  };

  const doGoogle = async () => {
    setLoading("google");
    try { await signIn(); } catch (e: any) { showError(e.message || "Error"); }
    finally { setLoading(null); }
  };

  const doApple = async () => {
    setLoading("apple");
    try { await signInWithApple(); }
    catch (e: any) {
      if (String(e?.code || e?.message).toLowerCase().includes("cancel")) { setLoading(null); return; }
      showError(e.message || "Error con Apple");
    }
    finally { setLoading(null); }
  };

  const doFacebook = async () => {
    Alert.alert("Facebook", "Contactá al desarrollador — se necesita configurar el App ID de Facebook.");
  };

  const doEmail = async () => {
    if (!email.trim() || !password) { showError("Completa email y contraseña"); return; }
    if (mode === "email-register" && password.length < 6) { showError("Mínimo 6 caracteres"); return; }
    setLoading("email");
    try {
      if (mode === "email-register") await registerWithEmail(email.trim(), password, name.trim() || undefined);
      else await signInWithEmail(email.trim(), password);
    } catch (e: any) { showError(e.message || "Error"); }
    finally { setLoading(null); }
  };

  // ---------- Email form view ----------
  if (mode !== "welcome") {
    const isRegister = mode === "email-register";
    return (
      <SafeAreaView style={styles.emailBg} edges={["top", "bottom"]} testID="email-auth-screen">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.emailScroll} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setMode("welcome")} style={styles.backBtn} testID="email-back-btn">
              <ArrowLeft color={theme.colors.onSurface} size={22} />
            </Pressable>

            <View style={styles.logoSmall}>
              <ShoppingBasket color="#fff" size={22} />
            </View>
            <Text style={styles.emailTitle}>{isRegister ? "Crear cuenta" : "Iniciar sesión"}</Text>
            <Text style={styles.emailSub}>
              {isRegister ? "Regístrate con tu correo" : "Ingresa con tu correo y contraseña"}
            </Text>

            {isRegister && (
              <View style={styles.inputBox}>
                <UserIcon color={theme.colors.muted} size={18} />
                <TextInput
                  testID="name-input"
                  value={name}
                  onChangeText={setName}
                  placeholder="Nombre (opcional)"
                  placeholderTextColor={theme.colors.muted}
                  style={styles.input}
                  autoCapitalize="words"
                />
              </View>
            )}
            <View style={styles.inputBox}>
              <Mail color={theme.colors.muted} size={18} />
              <TextInput
                testID="email-input"
                value={email}
                onChangeText={setEmail}
                placeholder="correo@ejemplo.com"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>
            <View style={styles.inputBox}>
              <Lock color={theme.colors.muted} size={18} />
              <TextInput
                testID="password-input"
                value={password}
                onChangeText={setPassword}
                placeholder="Contraseña"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowPw((s) => !s)} testID="toggle-pw-btn">
                {showPw ? <EyeOff color={theme.colors.muted} size={18} /> : <Eye color={theme.colors.muted} size={18} />}
              </Pressable>
            </View>

            {err && <Text style={styles.errText} testID="email-error">{err}</Text>}

            <Pressable
              testID={isRegister ? "register-submit-btn" : "login-submit-btn"}
              onPress={doEmail}
              disabled={loading === "email"}
              style={[styles.primaryBtn, loading === "email" && { opacity: 0.6 }]}
            >
              {loading === "email"
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryText}>{isRegister ? "Crear cuenta" : "Ingresar"}</Text>}
            </Pressable>

            <Pressable
              onPress={() => setMode(isRegister ? "email-login" : "email-register")}
              style={styles.switchLink}
              testID="switch-mode-btn"
            >
              <Text style={styles.switchText}>
                {isRegister ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---------- Welcome view ----------
  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/4451867/pexels-photo-4451867.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" }}
      style={styles.bg}
      testID="login-screen"
    >
      <LinearGradient colors={["rgba(17,24,39,0.15)", "rgba(17,24,39,0.55)", "rgba(17,24,39,0.95)"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={styles.logo}>
            <ShoppingBasket color="#fff" size={28} />
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.title}>Despensa</Text>
          <Text style={styles.subtitle}>Controla tus compras del mes con estilo</Text>

          {err && <Text style={styles.errTextWhite} testID="welcome-error">{err}</Text>}

          <Pressable
            testID="email-login-btn"
            onPress={() => setMode("email-login")}
            style={styles.primaryDark}
          >
            <Mail color="#fff" size={20} />
            <Text style={styles.primaryDarkText}>Continuar con correo</Text>
          </Pressable>

          <Pressable
            testID="google-login-button"
            onPress={doGoogle}
            disabled={loading === "google"}
            style={[styles.btn, loading === "google" && { opacity: 0.7 }]}
          >
            {loading === "google" ? (
              <ActivityIndicator color={theme.colors.onSurface} />
            ) : (
              <>
                <Text style={styles.g}>G</Text>
                <Text style={styles.btnText}>Google</Text>
              </>
            )}
          </Pressable>

          {Platform.OS === "ios" && appleAvailable && (
            <Pressable
              testID="apple-login-btn"
              onPress={doApple}
              disabled={loading === "apple"}
              style={[styles.applyBtn, loading === "apple" && { opacity: 0.7 }]}
            >
              {loading === "apple" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.apple}></Text>
                  <Text style={styles.appleText}>Apple</Text>
                </>
              )}
            </Pressable>
          )}

          {providers.facebook ? (
            <Pressable testID="facebook-login-btn" onPress={doFacebook} style={styles.fbBtn}>
              <Text style={styles.fbLogo}>f</Text>
              <Text style={styles.fbText}>Facebook</Text>
            </Pressable>
          ) : null}

          <Text style={styles.legal}>Guaraní, USD, EUR, BRL y ARS soportados</Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1, justifyContent: "space-between", padding: theme.spacing.xl },
  top: { alignItems: "flex-start" },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  bottom: { gap: 10 },
  title: { color: "#fff", fontSize: 44, fontWeight: "800", letterSpacing: -1 },
  subtitle: { color: "rgba(255,255,255,0.8)", fontSize: 16, marginBottom: 8 },
  errText: { color: theme.colors.error, fontSize: 13, textAlign: "center", marginTop: 8 },
  errTextWhite: { color: "#FCA5A5", fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 4 },
  btn: { backgroundColor: "#fff", borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  g: { color: "#DB4437", fontWeight: "900", fontSize: 20 },
  btnText: { color: theme.colors.onSurface, fontWeight: "700", fontSize: 15 },
  applyBtn: { backgroundColor: "#000", borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  apple: { color: "#fff", fontSize: 20, marginTop: -2 },
  appleText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  fbBtn: { backgroundColor: "#1877F2", borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  fbLogo: { color: "#fff", fontWeight: "900", fontSize: 20, fontStyle: "italic" },
  fbText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  primaryDark: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryDarkText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  legal: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: 12 },

  emailBg: { flex: 1, backgroundColor: theme.colors.surface },
  emailScroll: { padding: theme.spacing.xl, paddingTop: 20 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  logoSmall: { width: 48, height: 48, borderRadius: 14, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emailTitle: { fontSize: 28, fontWeight: "800", color: theme.colors.onSurface, letterSpacing: -0.5 },
  emailSub: { fontSize: 14, color: theme.colors.muted, marginBottom: 24, marginTop: 4 },
  inputBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 },
  input: { flex: 1, fontSize: 15, color: theme.colors.onSurface },
  primaryBtn: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, height: 52, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  switchLink: { alignItems: "center", padding: 16 },
  switchText: { color: theme.colors.brand, fontWeight: "600", fontSize: 14 },
});
