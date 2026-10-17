import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, saveToken, getToken, clearToken } from "./api";
import { exportLocalDatabase } from "./localStore";
import { storage } from "./utils/storage";

try { WebBrowser.maybeCompleteAuthSession(); } catch {}

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  preferred_currency: string;
};
export type AuthMode = "guest" | "authenticated" | "syncing";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  googleAuthError: string | null;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name?: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithFacebook: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: User | null) => void;
  mode: AuthMode;
  syncError: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const processedAuthCodes = new Set<string>();
const guestUser: User = {
  user_id: "local_guest",
  email: "",
  name: "Modo invitado",
  preferred_currency: "PYG",
};

async function migrateLocalData(userId: string) {
  const migratedRaw = await storage.getItem<string>("despensa_migrated_users", "[]");
  let migratedUsers: string[] = [];
  if (migratedRaw) {
    try {
      const parsed = JSON.parse(migratedRaw);
      if (Array.isArray(parsed)) migratedUsers = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      migratedUsers = [];
    }
  }
  if (migratedUsers.includes(userId)) return;
  const local = await exportLocalDatabase();
  const marketIds = new Map<string, string>();
  for (const market of local.markets) {
    const created = await api<any>("/markets", {
      method: "POST",
      body: { name: market.name, color: market.color },
    });
    marketIds.set(market.id, created.id);
  }
  for (const purchase of local.purchases) {
    await api("/purchases", {
      method: "POST",
      body: { ...purchase, id: undefined, market_id: marketIds.get(purchase.market_id) || undefined },
    });
  }
  for (const list of local.shoppingLists) {
    const created = await api<any>("/shopping-lists", {
      method: "POST",
      body: { name: list.name, currency: list.currency },
    });
    for (const item of list.items || []) {
      await api(`/shopping-lists/${created.id}/items`, {
        method: "POST",
        body: { ...item, id: undefined },
      });
    }
  }
  await storage.setItem("despensa_migrated_users", JSON.stringify([...migratedUsers, userId]));
}

function extractQueryValue(url: string, key: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const fromSearch = parsed.searchParams.get(key);
    if (fromSearch) return fromSearch;
    return new URLSearchParams(parsed.hash.replace(/^#/, "")).get(key);
  } catch {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = url.match(new RegExp(`[?#&]${escapedKey}=([^&#]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>("guest");
  const [syncError, setSyncError] = useState<string | null>(null);

  const completeLogin = useCallback(async (nextUser: User) => {
    setSyncError(null);
    setMode("syncing");
    try {
      await migrateLocalData(nextUser.user_id);
      setUser(nextUser);
      setMode("authenticated");
    } catch (error) {
      setUser(nextUser);
      setMode("authenticated");
      setSyncError(error instanceof Error ? error.message : "No se pudieron sincronizar los datos locales");
    }
  }, []);

  const exchangeGoogleCode = useCallback(async (authCode: string) => {
    if (processedAuthCodes.has(authCode)) return;
    processedAuthCodes.add(authCode);
    try {
      const res = await api<{ session_token: string; user: User }>("/auth/google/exchange", {
        method: "POST",
        body: { auth_code: authCode },
        auth: false,
      });
      await saveToken(res.session_token);
      await completeLogin(res.user);
    } catch (e) {
      processedAuthCodes.delete(authCode);
      console.warn("Error intercambiando el código propio de Google:", e);
      throw e;
    }
  }, [completeLogin]);

  const checkExisting = useCallback(async () => {
    console.log("1. [AUTH] Iniciando comprobación de sesión...");
    try {
      console.log("2. [AUTH] Obteniendo token de almacenamiento local...");
      const t = await Promise.race([
        getToken(),
        new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      console.log("3. [AUTH] Token:", t ? "Encontrado" : "No existe");

      if (t) {
        console.log("4. [AUTH] Verificando usuario con el backend...");
        const me = await Promise.race([
          api<User>("/auth/me"),
          new Promise<User>((_, reject) => setTimeout(() => reject(new Error("Timeout backend")), 2500)),
        ]);
        setUser(me);
        setMode("authenticated");
        console.log("5. [AUTH] Usuario validado:", me.email);
      } else {
        setUser(guestUser);
        setMode("guest");
      }
    } catch (e: any) {
      console.log("6. [AUTH] Excepción durante verificación:", e?.message || e);
      setUser(guestUser);
      setMode("guest");
    } finally {
      console.log("7. [AUTH] Apagando pantalla de carga (setLoading -> false)");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (Platform.OS === "web") {
        try {
          const currentUrl = typeof window !== "undefined" ? window.location.href : "";
          const authCode = extractQueryValue(currentUrl, "auth_code");
          const authError = extractQueryValue(currentUrl, "auth_error");
          if (authCode) {
            try {
              await exchangeGoogleCode(authCode);
            } catch (error) {
              setGoogleAuthError(error instanceof Error ? error.message : "No se pudo iniciar sesión con Google");
            }
            const url = new URL(window.location.href);
            url.searchParams.delete("auth_code");
            url.searchParams.delete("auth_error");
            window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
          } else if (authError) {
            setGoogleAuthError(authError);
            const url = new URL(window.location.href);
            url.searchParams.delete("auth_error");
            window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
          }
        } catch {}
      } else {
        try {
          const initial = await Promise.race([
            Linking.getInitialURL(),
            new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (initial) {
            const authCode = extractQueryValue(initial, "auth_code");
            if (authCode) await exchangeGoogleCode(authCode);
            const authError = extractQueryValue(initial, "auth_error");
            if (authError) setGoogleAuthError(authError);
          }
        } catch {}
      }
      if (mounted) await checkExisting();
    })();

    let sub: any = null;
    if (Platform.OS !== "web") {
      sub = Linking.addEventListener("url", (evt) => {
        const authCode = extractQueryValue(evt.url, "auth_code");
        if (authCode) exchangeGoogleCode(authCode).catch(() => {});
        const authError = extractQueryValue(evt.url, "auth_error");
        if (authError) setGoogleAuthError(authError);
      });
    }
    return () => {
      mounted = false;
      try { sub?.remove?.(); } catch {}
    };
  }, [exchangeGoogleCode, checkExisting]);

  const signIn = useCallback(async () => {
    setGoogleAuthError(null);
    const redirectUrl = Platform.OS === "web"
      ? (typeof window !== "undefined" ? `${window.location.origin}/` : "")
      : Linking.createURL("auth");
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/+$/, "");
    if (!backendUrl) throw new Error("La dirección del backend no está configurada");
    const authUrl = `${backendUrl}/api/auth/google/start?redirect_uri=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error("Inicio de sesión cancelado");
    }
    if (result.type !== "success" || !result.url) {
      throw new Error("Google no devolvió el resultado de autenticación");
    }
    const authError = extractQueryValue(result.url, "auth_error");
    if (authError) throw new Error(authError);
    const authCode = extractQueryValue(result.url, "auth_code");
    if (!authCode) throw new Error("Google no devolvió un código de inicio de sesión");
    await exchangeGoogleCode(authCode);
  }, [exchangeGoogleCode]);

  const signOut = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    setUser(guestUser);
    setMode("guest");
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/login", {
      method: "POST", body: { email, password }, auth: false,
    });
    await saveToken(res.session_token);
    await completeLogin(res.user);
  }, [completeLogin]);

  const registerWithEmail = useCallback(async (email: string, password: string, name?: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/register", {
      method: "POST", body: { email, password, name }, auth: false,
    });
    await saveToken(res.session_token);
    await completeLogin(res.user);
  }, [completeLogin]);

  const signInWithApple = useCallback(async () => {
    const AppleAuth = await import("expo-apple-authentication");
    const cred = await AppleAuth.signInAsync({
      requestedScopes: [
        AppleAuth.AppleAuthenticationScope.FULL_NAME,
        AppleAuth.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!cred.identityToken) throw new Error("Apple no devolvió token");
    const fullName = cred.fullName
      ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(" ")
      : undefined;
    const res = await api<{ session_token: string; user: User }>("/auth/apple", {
      method: "POST",
      body: { identity_token: cred.identityToken, name: fullName, email: cred.email },
      auth: false,
    });
    await saveToken(res.session_token);
    await completeLogin(res.user);
  }, [completeLogin]);

  const signInWithFacebook = useCallback(async (accessToken: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/facebook", {
      method: "POST", body: { access_token: accessToken }, auth: false,
    });
    await saveToken(res.session_token);
    await completeLogin(res.user);
  }, [completeLogin]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
      setMode("authenticated");
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, googleAuthError, signIn, signInWithEmail, registerWithEmail,
      signInWithApple, signInWithFacebook, signOut, refreshUser, setUser, mode, syncError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}