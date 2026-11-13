import type { AssetClass, Currency, Range } from "@/lib/types";
import { SYMBOL_RE, type Instrument } from "./providers";

const CLASSES: AssetClass[] = ["in_stock", "us_stock", "crypto", "mf"];
const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y", "5Y"];

export const isClass = (v: unknown): v is AssetClass => CLASSES.includes(v as AssetClass);
export const isRange = (v: unknown): v is Range => RANGES.includes(v as Range);

export function parseInstrument(v: unknown): Instrument | null {
  if (!v || typeof v !== "object") return null;
  const { cls, symbol, currency } = v as Record<string, unknown>;
  if (!isClass(cls)) return null;
  if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) return null;
  if (currency !== "INR" && currency !== "USD") return null;
  return { cls, symbol, currency: currency as Currency };
}

export const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
