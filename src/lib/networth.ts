"use client";

import { useEffect, useState } from "react";
import { cashBalances, type CashBalances } from "./cash";
import { convert, type Position } from "./portfolio";
import { fetchHistory, type Market } from "./prices";
import { CLASS_ORDER, type AssetClass, type Candle, type Currency, type VaultData } from "./types";

export interface DayValue {
  ts: number;
  /** Net worth at the end of the day. */
  value: number;
  /** Cost of what was held that day (money put in, average-cost method). */
  invested: number;
  byClass: Record<AssetClass, number>;
  /** Cash held at the end of the day (counted in value and invested, so never a gain). */
  cash: number;
  /**
   * Market gain or loss that day: units held at the previous close × the price change
   * (plus the exchange-rate change). Money added or taken out doesn't count.
   */
  move: number;
}

const DAY = 86_400_000;
export const HISTORY_DAYS = 365;

/** Last close at or before `ts` (candles sorted oldest first). */
export function closeAt(candles: { t: number; c: number }[], ts: number): number | null {
  let lo = 0;
  let hi = candles.length - 1;
  let found: number | null = null;
  const sec = ts / 1000;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= sec) {
      found = candles[mid].c;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * A year of daily closes for every asset with a price feed, fetched once for the whole
 * portfolio. Price services sometimes refuse a burst of requests, so failures are retried
 * twice with a pause; whatever still fails is reported, never silently guessed.
 */
export function useCloses(data: VaultData) {
  const [closes, setCloses] = useState<Record<string, Candle[]>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const feedIds = data.assets
    .filter((a) => a.symbol)
    .map((a) => a.id)
    .sort()
    .join("|");

  useEffect(() => {
    let alive = true;
    const wanted = data.assets.filter((a) => a.symbol);
    (async () => {
      const got: Record<string, Candle[]> = {};
      let todo = wanted;
      for (let attempt = 0; attempt < 3 && todo.length && alive; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, attempt === 1 ? 3000 : 9000));
        const results = await Promise.allSettled(todo.map((a) => fetchHistory(a, "1Y", true).then((c) => [a.id, c] as const)));
        for (const r of results) if (r.status === "fulfilled" && r.value[1].length) got[r.value[0]] = r.value[1];
        todo = todo.filter((a) => !got[a.id]);
        if (!alive) return;
        setCloses({ ...got });
        if (attempt === 0) setLoading(false);
      }
      if (!alive) return;
      setLoading(false);
      setMissing(todo.map((a) => a.id));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedIds]);

  return { closes, loading, missing };
}

const zeroClasses = () => Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<AssetClass, number>;

/**
 * Real net-worth history: value and money invested at the end of each of the last 365
 * days, rebuilt from the recorded trades and daily closing prices. Nothing is estimated
 * before a holding's first trade, so days before anything was held are dropped.
 */
export function buildSeries(
  data: VaultData,
  positions: Position[],
  closes: Record<string, Candle[]>,
  market: Pick<Market, "usdInr" | "fxSeries">,
  display: Currency,
): DayValue[] {
  const now = Date.now();
  const current = new Map(positions.map((p) => [p.asset.id, p.price]));
  const byAsset = data.assets.map((asset) => ({
    asset,
    txns: data.txns.filter((t) => t.assetId === asset.id).sort((a, b) => a.ts - b.ts),
  }));
  const out: DayValue[] = [];
  // Yesterday's units, price and rate per asset, for the daily market move.
  const prev = new Map<string, { qty: number; price: number; fx: number }>();
  let prevCash: { bal: CashBalances; fx: number } | null = null;
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const ts = i === 0 ? now : new Date(now - i * DAY).setHours(23, 59, 59, 999);
    const fxThen = i === 0 ? market.usdInr : (closeAt(market.fxSeries, ts) ?? market.usdInr);
    const day: DayValue = { ts, value: 0, invested: 0, byClass: zeroClasses(), cash: 0, move: 0 };
    // Cash: its value only moves with the exchange rate; money in or out isn't a move.
    const bal = cashBalances(data, ts);
    const cashIn = (b: CashBalances, fx: number) => convert(b.INR, "INR", display, fx) + convert(b.USD, "USD", display, fx);
    day.cash = cashIn(bal, fxThen);
    day.value += day.cash;
    day.invested += day.cash;
    if (prevCash) day.move += cashIn(prevCash.bal, fxThen) - cashIn(prevCash.bal, prevCash.fx);
    prevCash = { bal, fx: fxThen };
    for (const { asset, txns } of byAsset) {
      // Replay trades up to this day: units held and their average cost.
      let qty = 0;
      let cost = 0;
      let lastPrice = 0;
      for (const t of txns) {
        if (t.ts > ts) break;
        lastPrice = t.price;
        if (t.type === "buy") {
          qty += t.qty;
          cost += t.qty * t.price;
        } else {
          const sold = Math.min(t.qty, qty);
          if (qty > 0) cost -= (cost / qty) * sold;
          qty -= sold;
        }
      }
      const before = prev.get(asset.id);
      if (qty < 1e-9 && !before?.qty) continue;
      const price =
        (i === 0 ? current.get(asset.id) : null) ??
        (asset.useManual ? asset.manualPrice?.price : null) ??
        closeAt(closes[asset.id] ?? [], ts) ??
        lastPrice;
      if (before?.qty) {
        day.move +=
          convert(before.qty * price, asset.currency, display, fxThen) -
          convert(before.qty * before.price, asset.currency, display, before.fx);
      }
      prev.set(asset.id, { qty: qty < 1e-9 ? 0 : qty, price, fx: fxThen });
      if (qty < 1e-9) continue;
      const v = convert(qty * price, asset.currency, display, fxThen);
      day.value += v;
      day.invested += convert(cost, asset.currency, display, fxThen);
      day.byClass[asset.cls] += v;
    }
    out.push(day);
  }
  const first = out.findIndex((d) => d.value > 0 || d.invested > 0);
  return first < 0 ? out.slice(-1) : out.slice(first);
}
