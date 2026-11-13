import type { AssetClass, Currency } from "../types";
import type { Field } from "./table";

/**
 * Files Folio recognises by their header row, so the column step can be skipped.
 * Each was built against a real export; anything else falls back to column guessing.
 */
export interface Preset {
  id: string;
  title: string;
  account: string;
  cls: AssetClass;
  currency: Currency;
  cols: Partial<Record<Field, number>>;
  /** Column holding the purchase date, when the file has one. */
  dateCol?: number;
}

interface Def {
  id: string;
  title: string;
  account: string;
  cls: AssetClass;
  currency: Currency;
  /** Lower-cased header cells that must all be present. */
  need: string[];
  map: Partial<Record<Field, string>>;
  date?: string;
}

const DEFS: Def[] = [
  {
    id: "groww-stocks",
    title: "Groww stocks holdings statement",
    account: "Groww",
    cls: "in_stock",
    currency: "INR",
    need: ["stock name", "isin", "quantity", "average buy price", "closing value"],
    map: { name: "stock name", isin: "isin", qty: "quantity", avg: "average buy price", invested: "buy value", value: "closing value" },
  },
  {
    id: "groww-mf",
    title: "Groww mutual funds holdings",
    account: "Groww",
    cls: "mf",
    currency: "INR",
    need: ["scheme name", "amc", "units", "invested value", "current value"],
    map: { name: "scheme name", qty: "units", invested: "invested value", value: "current value" },
  },
  {
    id: "indmoney-us",
    title: "INDmoney US stocks holdings report",
    account: "INDmoney",
    cls: "us_stock",
    currency: "USD",
    need: ["stock symbol", "holding since", "quantity", "avg. price ($)"],
    map: { ticker: "stock symbol", qty: "quantity", avg: "avg. price ($)", value: "total value ($)" },
    date: "holding since",
  },
];

export function detectPreset(header: string[]): Preset | null {
  const cells = header.map((h) => h.trim().toLowerCase());
  for (const d of DEFS) {
    if (!d.need.every((n) => cells.includes(n))) continue;
    const cols: Partial<Record<Field, number>> = {};
    for (const [field, label] of Object.entries(d.map) as [Field, string][]) {
      const i = cells.indexOf(label);
      if (i >= 0) cols[field] = i;
    }
    const dateCol = d.date ? cells.indexOf(d.date) : -1;
    return {
      id: d.id,
      title: d.title,
      account: d.account,
      cls: d.cls,
      currency: d.currency,
      cols,
      dateCol: dateCol >= 0 ? dateCol : undefined,
    };
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Dates as Indian statements write them: "28 Jun 2026, 03:12 PM", "09-Nov-2026",
 * "2026-11-11", "11-11-2026" (day first). Returns epoch ms, or NaN.
 */
export function parseDate(raw: string): number {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    let h = m[4] ? Number(m[4]) : 12;
    if (m[6]?.toUpperCase() === "PM" && h < 12) h += 12;
    if (m[6]?.toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), h, m[5] ? Number(m[5]) : 0).getTime();
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12).getTime();
  return NaN;
}
