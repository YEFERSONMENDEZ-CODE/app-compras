import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Modal, Alert} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { X, Zap, ZapOff, Image as ImageIcon, Loader2 } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";


export default function ScanReceipt() {
  const router = useRouter();
  const { user } = useAuth();
  const [perm, requestPerm] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (!perm) return;
    if (!perm.granted && perm.canAskAgain) requestPerm();
  }, [perm]);

  const processImage = async (base64: string) => {
  setProcessing(true);
  try {
    const result: any = await api("/receipt/scan", {
      method: "POST",
      body: { image_base64: base64, currency: user?.preferred_currency || "PYG" },
    });

    const preload = JSON.stringify({
      currency: result.currency || user?.preferred_currency || "PYG",
      items: result.items || [],
    });

    router.replace({ pathname: "/add-purchase", params: { preload } });
  } catch (e: any) {
    console.warn("scan error", e);
    Alert.alert(
      "Error al escanear",
      e?.message || "No se pudo procesar la factura. Intenta enfocar mejor la imagen."
    );
  } finally {
    setProcessing(false);
  }
};

  const takePhoto = async () => {
    if (!cameraRef.current || processing) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (photo?.base64) await processImage(photo.base64);
    } catch (e) { console.warn(e); }
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (!res.canceled && res.assets[0]?.base64) {
      await processImage(res.assets[0].base64);
    }
  };

  if (!perm) {
    return <View style={styles.blackFull}><ActivityIndicator color="#fff" /></View>;
  }

  if (!perm.granted) {
    return (
      <SafeAreaView style={styles.permView} testID="camera-permission-screen">
        <View style={styles.permIcon}>
          <ImageIcon color={theme.colors.brand} size={40} />
        </View>
        <Text style={styles.permTitle}>Necesitamos la cámara</Text>
        <Text style={styles.permSub}>Para escanear facturas y agregar productos automáticamente</Text>
        <Pressable style={styles.primary} onPress={requestPerm} testID="grant-permission-btn">
          <Text style={styles.primaryText}>Permitir cámara</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={pickImage} testID="pick-image-btn">
          <Text style={styles.secondaryText}>Elegir desde galería</Text>
        </Pressable>
        <Pressable style={{ marginTop: 24 }} onPress={() => router.back()}>
          <Text style={{ color: theme.colors.muted }}>Cancelar</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.blackFull} testID="scan-receipt-screen">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={flash}
      />

      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="close-scan-btn">
            <X color="#fff" size={22} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => setFlash((f) => !f)} testID="flash-btn">
            {flash ? <Zap color="#F59E0B" size={22} /> : <ZapOff color="#fff" size={22} />}
          </Pressable>
        </View>

        <View style={styles.frameWrap}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <Text style={styles.hint}>Alinea la factura dentro del recuadro</Text>
        </View>

        <View style={styles.bottom}>
          <Pressable style={styles.smallBtn} onPress={pickImage} testID="gallery-btn">
            <ImageIcon color="#fff" size={22} />
          </Pressable>
          <Pressable style={styles.capture} onPress={takePhoto} testID="capture-btn">
            <View style={styles.captureInner} />
          </Pressable>
          <View style={styles.smallBtn} />
        </View>
      </SafeAreaView>

      <Modal transparent visible={processing} animationType="fade">
        <View style={styles.loading} testID="ocr-processing-modal">
          <ActivityIndicator size="large" color={theme.colors.brand} />
          <Text style={styles.loadingTitle}>Extrayendo productos…</Text>
          <Text style={styles.loadingSub}>Nuestra IA está leyendo tu factura</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  blackFull: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between" },
  top: { flexDirection: "row", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  frameWrap: { alignItems: "center", justifyContent: "center" },
  frame: { width: 280, height: 380, borderRadius: 16 },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "#fff" },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  hint: { color: "#fff", marginTop: theme.spacing.lg, fontSize: 14, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.lg },
  smallBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  capture: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" },
  permView: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  permIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.lg },
  permTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.onSurface, marginBottom: 8 },
  permSub: { fontSize: 14, color: theme.colors.muted, textAlign: "center", marginBottom: theme.spacing.xl },
  primary: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 40, paddingVertical: 14, marginBottom: 12 },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.pill, paddingHorizontal: 40, paddingVertical: 14 },
  secondaryText: { color: theme.colors.onSurface, fontWeight: "600" },
  loading: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 40 },
  loadingTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 20 },
  loadingSub: { color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 6, textAlign: "center" },
});
