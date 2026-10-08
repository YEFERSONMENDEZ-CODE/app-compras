import { Linking } from "react-native";
import { formatMoney } from "@/src/currency";

export function createWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function shareToWhatsApp(message: string): Promise<void> {
  return Linking.openURL(createWhatsAppUrl(message));
}

type ShoppingListShareData = {
  name: string;
  currency: string;
  items: {
    name: string;
    quantity: number;
    unit: "un" | "kg";
    status: "pending" | "bought" | "unavailable";
    paid_price?: number | null;
    paid_market_name?: string | null;
  }[];
};

export function createShoppingListShareMessage(list: ShoppingListShareData): string {
  const lines = [`🛒 *${list.name}*`, "", "*Productos:*"];
  for (const item of list.items) {
    const mark = item.status === "bought" ? "✅" : item.status === "unavailable" ? "⛔" : "⬜";
    const quantity = `${item.quantity || 1} ${item.unit === "kg" ? "kg" : "un"}`;
    const details = item.status === "bought" && item.paid_price != null
      ? ` — ${item.paid_market_name || "Mercado no indicado"} · ${formatMoney(item.paid_price * (item.quantity || 1), list.currency)}`
      : "";
    lines.push(`${mark} ${item.name} (${quantity})${details}`);
  }
  const spent = list.items
    .filter((item) => item.status === "bought")
    .reduce((total, item) => total + (item.paid_price || 0) * (item.quantity || 1), 0);
  if (spent > 0) lines.push("", `*Gastado:* ${formatMoney(spent, list.currency)}`);
  return lines.join("\n");
}
