import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, saveToken, getToken, clearToken } from "./api";

try { WebBrowser.maybeCompleteAuthSession(); } catch {}

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  preferred_currency: string;
};

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
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const processedAuthCodes = new Set<string>();

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
      setUser(res.user);
    } catch (e) {
      processedAuthCodes.delete(authCode);
      console.warn("Error intercambiando el código propio de Google:", e);
      throw e;
    }
  }, []);

  const checkExisting = useCallback(async () => {
    let t: string | null = null;
    try {
      // Race SecureStore/localStorage read against a 2s timeout so a
      // stuck native module can never keep the splash spinner alive.
      t = await Promise.race([
        getToken(),
        new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
    } catch {}
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      // Also cap the /auth/me call at 6s
      const me = await Promise.race([
        api<User>("/auth/me"),
        new Promise<User>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]);
      setUser(me);
    } catch (e: any) {
      // Only clear the token when the server explicitly says the session
      // is invalid (401). Timeouts and other transient errors must not
      // log the user out — retry on next app open.
      const msg = String(e?.message || "");
      if (msg.includes("HTTP 401") || msg.toLowerCase().includes("invalid session")) {
        try { await clearToken(); } catch {}
      }
    } finally {
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
          // Cap Linking.getInitialURL at 1.5s ? on some Android devices
          // this can hang and would block the whole boot sequence.
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
    setUser(null);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/login", {
      method: "POST", body: { email, password }, auth: false,
    });
    await saveToken(res.session_token);
    setUser(res.user);
  }, []);

  const registerWithEmail = useCallback(async (email: string, password: string, name?: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/register", {
      method: "POST", body: { email, password, name }, auth: false,
    });
    await saveToken(res.session_token);
    setUser(res.user);
  }, []);

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
    setUser(res.user);
  }, []);

  const signInWithFacebook = useCallback(async (accessToken: string) => {
    const res = await api<{ session_token: string; user: User }>("/auth/facebook", {
      method: "POST", body: { access_token: accessToken }, auth: false,
    });
    await saveToken(res.session_token);
    setUser(res.user);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, googleAuthError, signIn, signInWithEmail, registerWithEmail,
      signInWithApple, signInWithFacebook, signOut, refreshUser, setUser,
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
