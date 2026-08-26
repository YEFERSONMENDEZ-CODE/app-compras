export const theme = {
  colors: {
    surface: "#FFFFFF",
    onSurface: "#111827",
    surfaceSecondary: "#F9FAFB",
    onSurfaceSecondary: "#374151",
    surfaceTertiary: "#F3F4F6",
    onSurfaceTertiary: "#4B5563",
    surfaceInverse: "#111827",
    onSurfaceInverse: "#FFFFFF",
    brand: "#059669",
    brandPrimary: "#059669",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#D1FAE5",
    onBrandSecondary: "#065F46",
    brandTertiary: "#ECFDF5",
    onBrandTertiary: "#047857",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
    border: "#E5E7EB",
    borderStrong: "#D1D5DB",
    divider: "#F3F4F6",
    muted: "#9CA3AF",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  fontSize: { xs: 11, sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32, display: 40 },
} as const;

export const CATEGORY_COLORS: Record<string, string> = {
  verduras: "#10B981",
  frutas: "#F59E0B",
  carnes: "#EF4444",
  lacteos: "#3B82F6",
  panaderia: "#D97706",
  bebidas: "#8B5CF6",
  limpieza: "#06B6D4",
  higiene: "#EC4899",
  otros: "#6B7280",
};

export const CATEGORY_LABEL: Record<string, string> = {
  verduras: "Verduras",
  frutas: "Frutas",
  carnes: "Carnes",
  lacteos: "Lácteos",
  panaderia: "Panadería",
  bebidas: "Bebidas",
  limpieza: "Limpieza",
  higiene: "Higiene",
  otros: "Otros",
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL);
