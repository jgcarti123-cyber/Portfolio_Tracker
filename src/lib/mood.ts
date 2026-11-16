"use client";

import { useEffect, useState } from "react";
import { zoned } from "./session";
import type { AssetClass } from "./types";

export interface MoodReading {
  key: "crypto" | "india" | "us";
  source: string;
  value: number;
  label: string;
  /** "index" = 0–100 where higher is greed; "vix" = volatility, where higher is fear. */
  scale: "index" | "vix";
  /** 0 = deepest fear, 1 = most greed. For VIX: the share of the past year's closes above today's. */
  position?: number;
  weekAgo: number | null;
  monthAgo: number | null;
  asOf: number;
  history: { t: number; v: number }[];
}

/** Which market's mood applies to an asset type (Indian funds follow the Indian market). */
export const MOOD_FOR: Record<AssetClass, MoodReading["key"]> = { in_stock: "india", mf: "india", us_stock: "us", crypto: "crypto" };
export const MOOD_NAME: Record<MoodReading["key"], string> = { crypto: "Crypto", india: "India", us: "US" };

/** 0 = deepest fear, 1 = most greed, on one scale for every market (VIX is inverted: high VIX = fear). */
export function moodPosition(r: MoodReading) {
  if (typeof r.position === "number") return Math.max(0, Math.min(1, r.position));
  if (r.scale === "index") return Math.max(0, Math.min(1, r.value / 100));
  return 0.5; // an older cached VIX reading without its yearly rank: neutral rather than guessed
}

/** The timezone each reading's day is counted in (crypto's index is dated in UTC). */
const MOOD_TZ: Record<MoodReading["key"], string> = { crypto: "UTC", india: "Asia/Kolkata", us: "America/New_York" };

/** When a reading is from: "Today", "Fri close", or a date. `stale` is true when its market hasn't published today. */
export function moodStamp(r: MoodReading, now = Date.now()) {
  const tz = MOOD_TZ[r.key];
  const then = zoned(r.asOf, tz);
  const today = zoned(now, tz);
  if (then.ymd === today.ymd) return { text: "Today", stale: false };
  const days = Math.round((Date.parse(today.ymd) - Date.parse(then.ymd)) / 86_400_000);
  const text =
    days === 1 && r.key === "crypto"
      ? "Yesterday"
      : days < 7
        ? `${then.weekday} close`
        : new Date(r.asOf).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: tz });
  return { text, stale: r.key !== "crypto" };
}

/** Change since an earlier reading, and whether it points toward fear (VIX rising, an index falling). */
export function moodChange(r: MoodReading, prev: number | null) {
  if (prev === null) return null;
  const delta = Math.round((r.value - prev) * 10) / 10;
  return { delta, size: Math.abs(delta), fearer: r.scale === "vix" ? delta > 0 : delta < 0 };
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** A plain-words explanation of a reading, for hover. */
export function moodExplain(r: MoodReading, now = Date.now()) {
  const pos = moodPosition(r);
  const l = r.label.toLowerCase();
  const meaning =
    r.scale === "vix"
      ? pos < 0.2
        ? "US investors expect much bigger swings than usual."
        : pos < 0.4
          ? "US investors expect bigger swings than usual."
          : pos <= 0.6
            ? "US investors expect about the usual amount of swings."
            : "US investors expect smaller swings than usual."
      : l.includes("extreme fear")
        ? "Investors are very fearful."
        : l.includes("fear")
          ? "Investors are cautious."
          : l.includes("extreme greed")
            ? "Investors are very eager to buy."
            : l.includes("greed")
              ? "Investors are confident."
              : "Investors are neither fearful nor greedy.";
  const what =
    r.key === "crypto"
      ? "Crypto Fear & Greed Index (alternative.me), 0–100. It blends Bitcoin's volatility, trading momentum and volume, social media, Bitcoin's share of the crypto market and search trends. Under 25 is extreme fear; over 75 is extreme greed."
      : r.key === "india"
        ? "Market Mood Index (Tickertape), 0–100. It blends foreign investor flows, India VIX, Nifty momentum and breadth, price strength and gold demand. Under 30 is extreme fear; over 70 is extreme greed."
        : `CBOE Volatility Index (VIX): how much the S&P 500 is expected to swing over the next 30 days, read from options prices. Higher means more fear. At ${fmt(r.value)} it is calmer than ${Math.round(pos * 100)}% of trading days in the past year.`;
  // Crypto's index and the VIX's daily candle carry a date, not a reading time; India's MMI has a real timestamp.
  const day = new Date(r.asOf).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: MOOD_TZ[r.key] });
  const when = r.key === "india" ? new Date(r.asOf).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : r.key === "us" ? `the ${day} close` : day;
  return `${r.label}. ${meaning}\n\n${what}\n\nReading from ${moodStamp(r, now).text === "Today" ? "today" : when}.`;
}

/** Fear-to-greed colour: red, amber, neutral, green. */
export function moodColor(pos: number) {
  return pos < 0.25 ? "var(--down)" : pos < 0.45 ? "#e8871e" : pos <= 0.55 ? "#c9b56b" : "var(--up)";
}

let pending: Promise<{ readings: MoodReading[]; missing: MoodReading["key"][] } | null> | null = null;

/** Market mood readings, fetched once per session (the server caches for 30 minutes). */
export function useMood() {
  const [state, setState] = useState<{ readings: MoodReading[]; missing: MoodReading["key"][]; loading: boolean }>({ readings: [], missing: [], loading: true });
  useEffect(() => {
    let alive = true;
    pending ??= fetch("/api/mood")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    pending.then((d) => {
      if (!alive) return;
      if (!d) pending = null;
      setState({ readings: d?.readings ?? [], missing: d?.missing ?? [], loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
