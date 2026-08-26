export type Currency = {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  decimals: number;
};

export const DEFAULT_CURRENCIES: Currency[] = [
  { code: "PYG", name: "Guaraní Paraguayo", symbol: "₲", flag: "🇵🇾", decimals: 0 },
  { code: "USD", name: "Dólar Estadounidense", symbol: "$", flag: "🇺🇸", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺", decimals: 2 },
  { code: "BRL", name: "Real Brasileño", symbol: "R$", flag: "🇧🇷", decimals: 2 },
  { code: "ARS", name: "Peso Argentino", symbol: "$", flag: "🇦🇷", decimals: 2 },
];

export function currencyByCode(code: string): Currency {
  return DEFAULT_CURRENCIES.find((c) => c.code === code) || DEFAULT_CURRENCIES[0];
}

export function formatMoney(amount: number, code: string = "PYG"): string {
  const c = currencyByCode(code);
  const locale = code === "PYG" ? "es-PY" : code === "BRL" ? "pt-BR" : code === "ARS" ? "es-AR" : code === "EUR" ? "de-DE" : "en-US";
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  }).format(isFinite(amount) ? amount : 0);
  return `${c.symbol} ${n}`;
}

export function formatMoneyCompact(amount: number, code: string = "PYG"): string {
  const c = currencyByCode(code);
  if (Math.abs(amount) >= 1_000_000) {
    return `${c.symbol} ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000 && c.decimals === 0) {
    return `${c.symbol} ${(amount / 1_000).toFixed(1)}K`;
  }
  return formatMoney(amount, code);
}
