import { quoteKey, type Asset, type Currency, type Quote, type Txn, type VaultData } from "./types";

export interface Position {
  asset: Asset;
  qty: number;
  /** Cost of the units still held, in the asset's currency (average-cost method). */
  cost: number;
  avgPrice: number;
  price: number | null;
  priceSource: "live" | "manual" | "last-trade";
  priceTs: number | null;
  prevClose: number | null;
  value: number | null;
  dayChange: number | null;
  gain: number | null;
  /** qty per account */
  byAccount: Record<string, number>;
}

/** Quantity and average cost after replaying trades in time order. */
export function replay(txns: Txn[]) {
  let qty = 0;
  let cost = 0;
  const byAccount: Record<string, number> = {};
  for (const t of [...txns].sort((a, b) => a.ts - b.ts)) {
    if (t.type === "buy") {
      qty += t.qty;
      cost += t.qty * t.price;
      byAccount[t.accountId] = (byAccount[t.accountId] ?? 0) + t.qty;
    } else {
      const sold = Math.min(t.qty, qty);
      if (qty > 0) cost -= (cost / qty) * sold;
      qty -= sold;
      byAccount[t.accountId] = Math.max(0, (byAccount[t.accountId] ?? 0) - t.qty);
    }
  }
  if (qty < 1e-9) {
    qty = 0;
    cost = 0;
  }
  return { qty, cost, byAccount };
}

export function buildPositions(data: VaultData, quotes: Record<string, Quote>): Position[] {
  return data.assets
    .map((asset) => {
      const txns = data.txns.filter((t) => t.assetId === asset.id);
      const { qty, cost, byAccount } = replay(txns);
      const quote = asset.symbol ? quotes[quoteKey(asset)] : undefined;
      const lastTrade = [...txns].sort((a, b) => b.ts - a.ts)[0];

      let price: number | null = null;
      let priceSource: Position["priceSource"] = "live";
      let priceTs: number | null = null;
      let prevClose: number | null = null;

      if (asset.manualPrice && (asset.useManual || !asset.symbol || !quote)) {
        price = asset.manualPrice.price;
        priceSource = "manual";
        priceTs = asset.manualPrice.ts;
      } else if (quote) {
        price = quote.price;
        prevClose = quote.prevClose;
        priceTs = quote.ts;
      } else if (lastTrade) {
        price = lastTrade.price;
        priceSource = "last-trade";
        priceTs = lastTrade.ts;
      }

      const value = price === null ? null : qty * price;
      return {
        asset,
        qty,
        cost,
        avgPrice: qty > 0 ? cost / qty : 0,
        price,
        priceSource,
        priceTs,
        prevClose,
        value,
        dayChange: price !== null && prevClose !== null ? qty * (price - prevClose) : null,
        gain: value === null ? null : value - cost,
        byAccount,
      };
    })
    .filter((p) => p.qty > 0);
}

export const convert = (amount: number, from: Currency, to: Currency, usdInr: number) =>
  from === to ? amount : from === "USD" ? amount * usdInr : amount / usdInr;

export interface Totals {
  value: number;
  cost: number;
  gain: number;
  dayChange: number;
}

export function totals(positions: Position[], display: Currency, usdInr: number): Totals {
  const sum = { value: 0, cost: 0, gain: 0, dayChange: 0 };
  for (const p of positions) {
    const c = (n: number) => convert(n, p.asset.currency, display, usdInr);
    sum.value += c(p.value ?? p.cost);
    sum.cost += c(p.cost);
    sum.dayChange += c(p.dayChange ?? 0);
  }
  sum.gain = sum.value - sum.cost;
  return sum;
}

/** Units of an asset held at the end of a given moment. */
export function qtyAt(txns: Txn[], ts: number) {
  let q = 0;
  for (const t of txns) if (t.ts <= ts) q += t.type === "buy" ? t.qty : -t.qty;
  return Math.max(0, q);
}

/** Whether a record is a holding added to Folio as it stood, not a real buy/sell that day. Sales never are. */
export function isOpening(t: Txn, all: Txn[]) {
  if (t.opening !== undefined) return t.opening;
  if (t.type !== "buy") return false;
  // Older records carry no flag: the earliest unflagged buy of each asset is the entry made when it was added.
  const first = all
    .filter((x) => x.assetId === t.assetId && x.type === "buy" && x.opening === undefined)
    .reduce<Txn | null>((a, x) => (!a || x.ts < a.ts ? x : a), null);
  return first?.id === t.id;
}
