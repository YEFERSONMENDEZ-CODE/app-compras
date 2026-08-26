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
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "login";
    if (!user && !inAuthGroup) {
      router.replace("/login");
    } else if (user && inAuthGroup) {
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

  // Hard cap: if icon fonts don't finish loading in 4s (Expo Go on slow
  // networks can hang on the jsdelivr CDN), boot the app anyway. Icons
  // will tofu but the app will NOT get stuck on splash forever.
  useEffect(() => {
    const t = setTimeout(() => setFontsTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loaded || error || fontsTimedOut) {
      SplashScreen.hideAsync().catch(() => {});
    }
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
