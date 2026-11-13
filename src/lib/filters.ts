import { convert, type Position } from "./portfolio";
import type { AssetClass, Currency, VaultData } from "./types";

export type Show = "all" | "profit" | "loss" | "up" | "down";

export interface Filter {
  /** Empty = every type. */
  classes: AssetClass[];
  /** Empty = every broker. */
  accounts: string[];
  search: string;
  show: Show;
  /** "all", or only holdings priced in this currency. */
  priced: "all" | Currency;
  /** Hide holdings worth less than this, in the display currency. 0 = off. */
  minValue: number;
}

export const NO_FILTER: Filter = { classes: [], accounts: [], search: "", show: "all", priced: "all", minValue: 0 };

export const SHOW_LABEL: Record<Show, string> = {
  all: "All",
  profit: "In profit",
  loss: "In loss",
  up: "Up today",
  down: "Down today",
};

export const activeCount = (f: Filter) =>
  (f.classes.length ? 1 : 0) +
  (f.accounts.length ? 1 : 0) +
  (f.search.trim() ? 1 : 0) +
  (f.show !== "all" ? 1 : 0) +
  (f.priced !== "all" ? 1 : 0) +
  (f.minValue > 0 ? 1 : 0);

/** Filters only found under "More filters", for its badge. */
export const moreCount = (f: Filter) => (f.show !== "all" ? 1 : 0) + (f.priced !== "all" ? 1 : 0) + (f.minValue > 0 ? 1 : 0);

const matches = (p: Position, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [p.asset.name, p.asset.ticker, p.asset.symbol].some((x) => x?.toLowerCase().includes(s));
};

/**
 * Narrows a position to the chosen brokers. A holding split across brokers keeps only
 * the selected brokers' share of its units, cost, value and today's move.
 */
function forAccounts(p: Position, accounts: string[]): Position | null {
  if (!accounts.length) return p;
  const byAccount = Object.fromEntries(Object.entries(p.byAccount).filter(([id, q]) => accounts.includes(id) && q > 0));
  const held = Object.values(byAccount).reduce((a, b) => a + b, 0);
  if (held <= 0) return null;
  const f = Math.min(1, held / p.qty);
  if (f === 1) return { ...p, byAccount };
  const scale = (n: number | null) => (n === null ? null : n * f);
  return {
    ...p,
    qty: held,
    cost: p.cost * f,
    value: scale(p.value),
    dayChange: scale(p.dayChange),
    gain: scale(p.gain),
    byAccount,
  };
}

/**
 * The dashboard's view of the portfolio under a filter: the positions to show, and the
 * matching slice of trades so the net-worth history follows the same filter.
 */
export function applyFilter(
  positions: Position[],
  data: VaultData,
  f: Filter,
  display: Currency,
  usdInr: number,
): { positions: Position[]; data: VaultData } {
  if (!activeCount(f)) return { positions, data };
  const out: Position[] = [];
  for (const p0 of positions) {
    if (f.classes.length && !f.classes.includes(p0.asset.cls)) continue;
    if (f.priced !== "all" && p0.asset.currency !== f.priced) continue;
    if (!matches(p0, f.search)) continue;
    const p = forAccounts(p0, f.accounts);
    if (!p) continue;
    if (f.show === "profit" && !((p.gain ?? 0) > 0)) continue;
    if (f.show === "loss" && !((p.gain ?? 0) < 0)) continue;
    if (f.show === "up" && !((p.dayChange ?? 0) > 0)) continue;
    if (f.show === "down" && !((p.dayChange ?? 0) < 0)) continue;
    if (f.minValue > 0 && convert(p.value ?? p.cost, p.asset.currency, display, usdInr) < f.minValue) continue;
    out.push(p);
  }
  const ids = new Set(out.map((p) => p.asset.id));
  return {
    positions: out,
    data: {
      ...data,
      assets: data.assets.filter((a) => ids.has(a.id)),
      txns: data.txns.filter((t) => ids.has(t.assetId) && (!f.accounts.length || f.accounts.includes(t.accountId))),
      // Cash isn't a holding, so a filtered view leaves it out.
      cash: [],
    },
  };
}

export type SortKey = "value" | "invested" | "return" | "today" | "name";
export interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

export function sortPositions(list: Position[], s: Sort, display: Currency, usdInr: number) {
  const inDisplay = (p: Position, n: number | null) => (n === null ? -Infinity : convert(n, p.asset.currency, display, usdInr));
  const key = (p: Position): number | string => {
    switch (s.key) {
      case "name":
        return p.asset.name.toLowerCase();
      case "invested":
        return inDisplay(p, p.cost);
      case "return":
        return p.gain !== null && p.cost > 0 ? p.gain / p.cost : -Infinity;
      case "today":
        return p.price !== null && p.prevClose ? (p.price - p.prevClose) / p.prevClose : -Infinity;
      default:
        return inDisplay(p, p.value ?? p.cost);
    }
  };
  const sign = s.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (typeof ka === "string" && typeof kb === "string") return ka.localeCompare(kb) * sign;
    return ((ka as number) - (kb as number)) * sign || a.asset.name.localeCompare(b.asset.name);
  });
}
