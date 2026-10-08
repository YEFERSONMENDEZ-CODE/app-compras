import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // Oculta el splash screen tan pronto como la autenticación determine el estado
    SplashScreen.hideAsync().catch(() => {});

    const currentRoute = segments[0];
    const allowedAuthenticatedRoutes = ["(tabs)", "add-purchase", "scan-receipt", "shopping-list", "index"];
    const inAuthRoute = currentRoute === "login";
    const inAllowedAuthenticatedRoute = allowedAuthenticatedRoutes.includes(currentRoute ?? "");

    if (!user && !inAuthRoute) {
      // Si no hay usuario y no está en login -> Redirigir a login
      router.replace("/login");
    } else if (user && !inAllowedAuthenticatedRoute) {
      // Si hay usuario autenticado y entra a una ruta no permitida, devolverlo a la pantalla principal
      router.replace("/(tabs)");
    }
  }, [user, loading, segments]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#FFFFFF" } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="add-purchase" options={{ presentation: "modal" }} />
      <Stack.Screen name="scan-receipt" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="shopping-list/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  // Límite de 3 segundos para la descarga de fuentes de iconos
  useEffect(() => {
    const t = setTimeout(() => setFontsTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // Límite máximo de 4 segundos para liberar la pantalla de carga (Splash Screen)
  // aunque el backend en Render esté tardando en despertar.
  useEffect(() => {
    const forceHideTimer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 4000);

    if (loaded || error || fontsTimedOut) {
      SplashScreen.hideAsync().catch(() => {});
    }

    return () => clearTimeout(forceHideTimer);
  }, [loaded, error, fontsTimedOut]);

  if (!loaded && !error && !fontsTimedOut) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <AuthGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}