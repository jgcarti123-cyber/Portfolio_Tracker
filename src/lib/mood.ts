"use client";

import { useEffect, useState } from "react";
import type { AssetClass } from "./types";

export interface MoodReading {
  key: "crypto" | "india" | "us";
  source: string;
  value: number;
  label: string;
  /** "index" = 0–100 where higher is greed; "vix" = volatility, where higher is fear. */
  scale: "index" | "vix";
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
  if (r.scale === "index") return Math.max(0, Math.min(1, r.value / 100));
  return Math.max(0, Math.min(1, 1 - (r.value - 10) / 30));
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
