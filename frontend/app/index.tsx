import { View, ActivityIndicator, StyleSheet } from "react-native";
import { theme } from "@/src/theme";

export default function Index() {
  return (
    <View style={styles.c} testID="splash-screen">
      <ActivityIndicator color={theme.colors.brand} size="large" />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
});
