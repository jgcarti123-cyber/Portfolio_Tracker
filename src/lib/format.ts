import type { Currency } from "./types";

const locale = (c: Currency) => (c === "INR" ? "en-IN" : "en-US");

export function money(n: number, c: Currency, opts: { decimals?: number } = {}) {
  const decimals = opts.decimals ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat(locale(c), {
    style: "currency",
    currency: c,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Per-unit price: keeps precision for sub-rupee coins and NAVs. */
export function price(n: number, c: Currency) {
  const a = Math.abs(n);
  const decimals = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return new Intl.NumberFormat(locale(c), {
    style: "currency",
    currency: c,
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** ₹12.4L, ₹1.82Cr, $18.6K — for axis ticks and tight spots. */
export function compact(n: number, c: Currency) {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (c === "INR") {
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
    return `${sign}₹${a.toFixed(0)}`;
  }
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export function qty(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: n >= 100 ? 2 : 6 }).format(n);
}

export function pct(n: number) {
  if (!isFinite(n)) return "–";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function signed(n: number, c: Currency) {
  return `${n > 0 ? "+" : ""}${money(n, c)}`;
}

export function dateTime(ts: number) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function day(ts: number, withYear = false) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(ts: number) {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
