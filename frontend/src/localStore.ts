import { storage } from "./utils/storage";

const STORAGE_KEY = "despensa_local_database_v1";

type LocalDatabase = {
  markets: any[];
  purchases: any[];
  shoppingLists: any[];
  currency: string;
};

const emptyDatabase = (): LocalDatabase => ({
  markets: [],
  purchases: [],
  shoppingLists: [],
  currency: "PYG",
});

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function read(): Promise<LocalDatabase> {
  const raw = await storage.getItem<string | null>(STORAGE_KEY, null);
  if (!raw) return emptyDatabase();
  try {
    const value = JSON.parse(raw) as Partial<LocalDatabase>;
    return { ...emptyDatabase(), ...value };
  } catch {
    return emptyDatabase();
  }
}

async function write(database: LocalDatabase) {
  const ok = await storage.setItem(STORAGE_KEY, JSON.stringify(database));
  if (!ok) throw new Error("No se pudo guardar la información en el dispositivo");
}

function monthOf(value: string) {
  return value.slice(0, 7);
}

function report(database: LocalDatabase, month: string) {
  const result: any = {
    total_by_currency: {},
    by_category: {},
    by_market: {},
  };
  database.purchases
    .filter((purchase) => monthOf(purchase.date || purchase.created_at || "") === month)
    .forEach((purchase) => {
      const currency = purchase.currency || database.currency;
      const total = Number(purchase.total ?? purchase.amount ?? 0);
      result.total_by_currency[currency] = (result.total_by_currency[currency] || 0) + total;
      const market = database.markets.find((item) => item.id === purchase.market_id);
      const marketName = market?.name || purchase.market_name || "Sin mercado";
      result.by_market[marketName] ||= {};
      result.by_market[marketName][currency] = (result.by_market[marketName][currency] || 0) + total;
      (purchase.items || []).forEach((item: any) => {
        const category = item.category || "other";
        result.by_category[category] ||= {};
        result.by_category[category][currency] =
          (result.by_category[category][currency] || 0) +
          Number(item.total ?? item.price ?? 0);
      });
    });
  return result;
}

export async function localApi<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const database = await read();
  const method = opts.method || "GET";
  const [rawPath, query] = path.split("?");
  const parts = rawPath.split("/").filter(Boolean);
  const body = opts.body || {};

  if (rawPath === "/currencies") {
    return [
      { code: "PYG", name: "Guaraní paraguayo", symbol: "₲", flag: "🇵🇾" },
      { code: "USD", name: "Dólar estadounidense", symbol: "$", flag: "🇺🇸" },
      { code: "ARS", name: "Peso argentino", symbol: "$", flag: "🇦🇷" },
      { code: "BRL", name: "Real brasileño", symbol: "R$", flag: "🇧🇷" },
    ] as T;
  }
  if (rawPath === "/auth/me") {
    return {
      user_id: "local_guest",
      email: "",
      name: "Modo invitado",
      preferred_currency: database.currency,
    } as T;
  }
  if (rawPath === "/auth/currency" && method === "PUT") {
    database.currency = body.currency || "PYG";
    await write(database);
    return { ok: true } as T;
  }
  if (parts[0] === "markets") {
    if (method === "GET") return database.markets as T;
    if (method === "POST") {
      const market = { id: id("market"), name: body.name, color: body.color || "#4F46E5", created_at: new Date().toISOString() };
      database.markets.push(market);
      await write(database);
      return market as T;
    }
    const market = database.markets.find((item) => item.id === parts[1]);
    if (method === "PUT" && market) {
      Object.assign(market, body);
      await write(database);
      return market as T;
    }
    if (method === "DELETE") {
      database.markets = database.markets.filter((item) => item.id !== parts[1]);
      await write(database);
      return { ok: true } as T;
    }
  }
  if (parts[0] === "purchases") {
    if (method === "GET") {
      const month = new URLSearchParams(query || "").get("month");
      return (month
        ? database.purchases.filter((purchase) => monthOf(purchase.date || purchase.created_at || "") === month)
        : database.purchases) as T;
    }
    if (method === "POST") {
      const purchase = { ...body, id: id("purchase"), date: body.date || new Date().toISOString(), created_at: new Date().toISOString() };
      database.purchases.push(purchase);
      await write(database);
      return purchase as T;
    }
    const purchase = database.purchases.find((item) => item.id === parts[1]);
    if (method === "GET") return purchase as T;
    if (method === "PUT" && purchase) {
      Object.assign(purchase, body);
      await write(database);
      return purchase as T;
    }
    if (method === "DELETE") {
      database.purchases = database.purchases.filter((item) => item.id !== parts[1]);
      await write(database);
      return { ok: true } as T;
    }
  }
  if (parts[0] === "shopping-lists") {
    if (parts.length === 1 && method === "GET") return database.shoppingLists as T;
    if (parts.length === 1 && method === "POST") {
      const list = { id: id("list"), name: body.name, currency: body.currency || database.currency, items: [], created_at: new Date().toISOString() };
      database.shoppingLists.push(list);
      await write(database);
      return list as T;
    }
    const list = database.shoppingLists.find((item) => item.id === parts[1]);
    if (!list) throw new Error("Lista no encontrada");
    if (parts.length === 2 && method === "GET") return list as T;
    if (parts.length === 2 && method === "DELETE") {
      database.shoppingLists = database.shoppingLists.filter((item) => item.id !== list.id);
      await write(database);
      return { ok: true } as T;
    }
    if (parts[2] === "items") {
      if (parts.length === 3 && method === "POST") {
        const item = { ...body, id: id("item"), status: body.status || "pending" };
        list.items.push(item);
        await write(database);
        return list as T;
      }
      if (parts.length === 4) {
        const item = list.items.find((entry: any) => entry.id === parts[3]);
        if (method === "PUT" && item) Object.assign(item, body);
        if (method === "DELETE") list.items = list.items.filter((entry: any) => entry.id !== parts[3]);
        await write(database);
        return list as T;
      }
    }
    if (parts[2] === "complete" && method === "POST") {
      const bought = list.items.filter((item: any) => item.status === "bought" && !item.imported_purchase_id);
      if (!bought.length) return { list, imported_count: 0 } as T;
      const purchaseId = id("purchase");
      const purchase = {
        id: purchaseId,
        name: list.name,
        currency: list.currency,
        date: new Date().toISOString(),
        total: bought.reduce((sum: number, item: any) => sum + Number(item.paid_price ?? item.estimated_price ?? 0) * Number(item.quantity || 1), 0),
        items: bought,
      };
      bought.forEach((item: any) => { item.imported_purchase_id = purchaseId; });
      database.purchases.push(purchase);
      await write(database);
      return { list, imported_count: bought.length } as T;
    }
  }
  if (parts[0] === "products" && parts[1] === "history") {
    const items = database.purchases.flatMap((purchase: any) => purchase.items || []);
    const search = new URLSearchParams(query || "").get("q")?.trim().toLowerCase();
    const grouped = new Map<string, any>();
    items.forEach((item: any) => {
      const key = String(item.name || "").trim().toLowerCase();
      if (!key) return;
      if (search && !key.includes(search)) return;
      const entry = grouped.get(key) || { name: item.name, category: item.category || "other", unit: item.unit || "un", prices: [] };
      entry.prices.push({ price: Number(item.paid_price ?? item.price ?? item.estimated_price ?? 0), currency: item.currency || database.currency, date: item.paid_at || new Date().toISOString(), market_name: item.paid_market_name || "Sin mercado" });
      grouped.set(key, entry);
    });
    return Array.from(grouped.values()) as T;
  }
  if (parts[0] === "reports" && parts[1] === "monthly") {
    const monthValue = new URLSearchParams(query || "").get("month") || monthOf(new Date().toISOString());
    return report(database, monthValue) as T;
  }
  throw new Error(`La operación local no está disponible: ${method} ${path}`);
}

export async function exportLocalDatabase() {
  return read();
}
