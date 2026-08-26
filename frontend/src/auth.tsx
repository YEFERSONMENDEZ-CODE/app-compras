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

const processedSessions = new Set<string>();

function extractSessionId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    if (processedSessions.has(sessionId)) return;
    processedSessions.add(sessionId);
    try {
      const res = await api<{ session_token: string; user: User }>("/auth/session", {
        method: "POST",
        body: { session_id: sessionId },
        auth: false,
      });
      await saveToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.warn("exchange failed", e);
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
      // First handle deep link session_id (mobile cold start / web mount)
      if (Platform.OS === "web") {
        try {
          const search = typeof window !== "undefined" ? window.location.search + window.location.hash : "";
          const sid = extractSessionId(search);
          if (sid) {
            await exchangeSessionId(sid);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete("session_id");
              const cleanHash = url.hash.replace(/[?#&]?session_id=[^&#]+/, "");
              window.history.replaceState(window.history.state, "", url.pathname + url.search + cleanHash);
            } catch {}
          }
        } catch {}
      } else {
        try {
          // Cap Linking.getInitialURL at 1.5s — on some Android devices
          // this can hang and would block the whole boot sequence.
          const initial = await Promise.race([
            Linking.getInitialURL(),
            new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (initial) {
            const sid = extractSessionId(initial);
            if (sid) await exchangeSessionId(sid);
          }
        } catch {}
      }
      if (mounted) await checkExisting();
    })();

    let sub: any = null;
    if (Platform.OS !== "web") {
      sub = Linking.addEventListener("url", (evt) => {
        const sid = extractSessionId(evt.url);
        if (sid) exchangeSessionId(sid);
      });
    }
    return () => {
      mounted = false;
      try { sub?.remove?.(); } catch {}
    };
  }, [exchangeSessionId, checkExisting]);

  const signIn = useCallback(async () => {
    const redirectUrl = Platform.OS === "web"
      ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
      : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && (result as any).url) url = (result as any).url;
    if (!url) {
      try {
        url = await Linking.getInitialURL();
      } catch {}
    }
    if (url) {
      const sid = extractSessionId(url);
      if (sid) await exchangeSessionId(sid);
    }
  }, [exchangeSessionId]);

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
      user, loading, signIn, signInWithEmail, registerWithEmail,
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
