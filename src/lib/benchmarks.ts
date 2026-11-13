"use client";

import { useEffect, useState } from "react";
import { BENCHES, type BenchId } from "./insights";
import { fetchHistory } from "./prices";
import type { Candle } from "./types";

type Bench = Partial<Record<BenchId, Candle[]>>;
let pending: Promise<Bench> | null = null;

/** A year of real daily closes for the reference markets; fetched once per session, retried once. */
async function load(): Promise<Bench> {
  const got: Bench = {};
  let todo = [...BENCHES];
  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000));
    const results = await Promise.allSettled(todo.map((b) => fetchHistory(b, "1Y", true).then((c) => [b.id, c] as const)));
    for (const r of results) if (r.status === "fulfilled" && r.value[1].length) got[r.value[0]] = r.value[1];
    todo = todo.filter((b) => !got[b.id]);
  }
  return got;
}

export function useBenchmarks() {
  const [state, setState] = useState<{ bench: Bench; loading: boolean }>({ bench: {}, loading: true });
  useEffect(() => {
    let alive = true;
    pending ??= load().catch(() => ({}));
    pending.then((bench) => {
      if (!alive) return;
      setState({ bench, loading: false });
      // Nothing came back: let a later visit try again.
      if (!Object.keys(bench).length) pending = null;
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
