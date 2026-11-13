"use client";

import { useEffect, useMemo, useState } from "react";
import {
  quoteKey,
  type Asset,
  type AssetClass,
  type Candle,
  type Quote,
  type Range,
  type SearchHit,
} from "./types";

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

export const searchAssets = (q: string, cls: AssetClass, signal?: AbortSignal) =>
  post<{ hits: SearchHit[] }>("/api/search", { q, cls }, signal).then((r) => r.hits);

export const fetchHistory = (
  a: Pick<Asset, "cls" | "symbol" | "currency">,
  range: Range,
  daily = false,
  signal?: AbortSignal,
) =>
  post<{ candles: Candle[] }>(
    "/api/history",
    { cls: a.cls, symbol: a.symbol, currency: a.currency, range, daily },
    signal,
  ).then((r) => r.candles);

export interface Market {
  quotes: Record<string, Quote>;
  usdInr: number;
  fxSeries: { t: number; c: number }[];
  loading: boolean;
  updatedAt: number | null;
}

const FALLBACK_FX = 88;

/** Live prices for the given assets, refreshed every minute while the tab is visible. */
export function useMarket(assets: Asset[]): Market {
  const [state, setState] = useState<Market>({
    quotes: {},
    usdInr: FALLBACK_FX,
    fxSeries: [],
    loading: true,
    updatedAt: null,
  });

  const items = useMemo(
    () =>
      assets
        .filter((a) => a.symbol)
        .map((a) => ({ cls: a.cls, symbol: a.symbol, currency: a.currency })),
    [assets],
  );
  const signature = items.map(quoteKey).sort().join("|");

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      post<{ quotes: Record<string, Quote>; usdInr: number | null; fxSeries: Market["fxSeries"] }>(
        "/api/quotes",
        { items },
      )
        .then((r) => {
          if (!alive) return;
          setState((s) => ({
            quotes: { ...s.quotes, ...r.quotes },
            usdInr: r.usdInr ?? s.usdInr,
            fxSeries: r.fxSeries.length ? r.fxSeries : s.fxSeries,
            loading: false,
            updatedAt: Date.now(),
          }));
        })
        .catch(() => alive && setState((s) => ({ ...s, loading: false })));
    };
    load();
    const timer = setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return state;
}
