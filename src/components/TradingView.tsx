"use client";

import { useEffect, useRef } from "react";
import type { Asset } from "@/lib/types";

/**
 * TradingView symbol for an asset, or null when TradingView doesn't list it (Indian
 * mutual funds, or anything without a market symbol).
 */
export function tvSymbol(a: Pick<Asset, "cls" | "symbol" | "ticker">): string | null {
  const sym = (a.symbol || "").toUpperCase();
  if (a.cls === "mf" || !sym) return null;
  if (a.cls === "in_stock") {
    if (sym.endsWith(".NS")) return `NSE:${sym.slice(0, -3)}`;
    if (sym.endsWith(".BO")) return `BSE:${sym.slice(0, -3)}`;
    return `NSE:${sym}`;
  }
  if (a.cls === "us_stock") return sym.replace(/-/g, ".");
  // Crypto: priced against the US dollar, as Folio does.
  const t = (a.ticker || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t ? `${t}USD` : null;
}

/**
 * Whether TradingView's free embed can show it. NSE/BSE stocks are licensed for
 * tradingview.com only ("This symbol is only available on TradingView"), so Indian
 * stocks get the link but not the embedded chart.
 */
export const tvEmbeddable = (a: Pick<Asset, "cls">) => a.cls === "us_stock" || a.cls === "crypto";

export const tvUrl = (symbol: string) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

/**
 * TradingView's free embedded chart for one symbol (indicators, drawing tools). Loaded
 * only when asked for; TradingView then knows which asset is being viewed.
 */
export function TradingViewChart({ symbol, theme }: { symbol: string; theme: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    el.appendChild(widget);
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: theme === "dark" ? "dark" : "light",
      style: "1",
      locale: "en",
      // Match the card so the chart sits flush (transparent leaves grey bands behind the legend).
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || (theme === "dark" ? "#14171d" : "#ffffff"),
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(s);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, theme]);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      {/* Sits behind the chart; TradingView's opaque chart covers it once loaded. */}
      <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
          Loading TradingView…
        </span>
      </div>
      <div ref={box} className="tradingview-widget-container relative h-full w-full" />
    </div>
  );
}

export const ExternalIcon = (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 2.5H2.5v7h7V7M7 2h3v3M10 2 5.5 6.5" />
  </svg>
);
