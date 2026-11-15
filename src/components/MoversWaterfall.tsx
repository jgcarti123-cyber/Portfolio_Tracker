"use client";

import { useEffect, useState } from "react";
import { compact, day, money, pct, price as fmtPrice, signed } from "@/lib/format";
import { MOOD_FOR, moodColor, moodPosition, type MoodReading } from "@/lib/mood";
import { convert } from "@/lib/portfolio";
import { fetchHistory } from "@/lib/prices";
import type { Mover, Today } from "@/lib/today";
import { CLASS_META, type AssetClass, type Candle, type Currency, type Quote } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Card, IconTile } from "./ui";

type Step = { key: string; label: string; sub: string; amount: number; mover?: Mover; cls?: AssetClass; kind: "holding" | "more" | "fx" };

const SHOW = 8;

/** The market each asset type is compared with today. */
const BENCH: Record<AssetClass, { key: string; label: string; item: { cls: AssetClass; symbol: string; currency: Currency } }> = {
  in_stock: { key: "nifty", label: "Nifty 50", item: { cls: "in_stock", symbol: "^NSEI", currency: "INR" } },
  mf: { key: "nifty", label: "Nifty 50", item: { cls: "in_stock", symbol: "^NSEI", currency: "INR" } },
  us_stock: { key: "sp500", label: "S&P 500", item: { cls: "us_stock", symbol: "^GSPC", currency: "USD" } },
  crypto: { key: "btc", label: "Bitcoin", item: { cls: "crypto", symbol: "bitcoin", currency: "USD" } },
};
const qk = (i: { cls: string; symbol: string; currency: string }) => `${i.cls}:${i.symbol}:${i.currency}`;

/** Today's move of each benchmark market (Nifty 50, S&P 500, Bitcoin), refreshed every minute. */
function useMarketMoves() {
  const [moves, setMoves] = useState<Record<string, Quote>>({});
  useEffect(() => {
    let alive = true;
    const items = [BENCH.in_stock.item, BENCH.us_stock.item, BENCH.crypto.item];
    const load = () =>
      fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d?.quotes && setMoves(d.quotes))
        .catch(() => {});
    load();
    const t = setInterval(() => !document.hidden && load(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return moves;
}

/** Today's price path for one holding (intraday), cached for the session. */
const pathCache = new Map<string, Candle[]>();
function usePricePath(m: Mover | undefined) {
  const id = m?.position.asset.id;
  const [state, setState] = useState<{ id?: string; candles: Candle[] | null }>({ candles: null });
  useEffect(() => {
    if (!m || m.position.asset.cls === "mf") return;
    const a = m.position.asset;
    const hit = pathCache.get(a.id);
    if (hit) {
      const t = requestAnimationFrame(() => setState({ id: a.id, candles: hit }));
      return () => cancelAnimationFrame(t);
    }
    const ctrl = new AbortController();
    fetchHistory(a, "1D", false, ctrl.signal)
      .then((c) => {
        pathCache.set(a.id, c);
        setState({ id: a.id, candles: c });
      })
      .catch(() => !ctrl.signal.aborted && setState({ id: a.id, candles: [] }));
    return () => ctrl.abort();
  }, [m]);
  return state.id === id ? state.candles : null;
}

/**
 * Today as a waterfall from yesterday's close to now, with a detail panel for the selected
 * move: its price path today, how it compares with its market, its market's mood, and where
 * today sits in its recent history.
 */
export function MoversWaterfall({ today, currency, moods, closes, onOpen, bare = false }: { today: Today; currency: Currency; moods: MoodReading[]; closes: Record<string, Candle[]>; onOpen: (id: string) => void; bare?: boolean }) {
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const market = useMarketMoves();

  const movers = cls === "all" ? today.movers : today.movers.filter((m) => m.position.asset.cls === cls);
  const sorted = [...movers].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const selected = sorted.find((m) => m.position.asset.id === picked) ?? sorted[0];
  const path = usePricePath(selected);
  if (!today.movers.length) {
    if (!today.closed.length) return null;
    // Every market you hold is closed today: say so rather than show an old session's moves.
    const names = today.closed.map((c) => CLASS_META[c].label.toLowerCase());
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    return (
      <Card className="p-5 sm:p-6" bare={bare}>
        <div className="grid place-items-center py-14 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-sunken ring-1 ring-line" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-ink-3">
              <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z" />
            </svg>
          </span>
          <p className="mt-4 text-[15px] font-semibold">Nothing has moved today</p>
          <p className="mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-ink-3">
            Your {list} haven&apos;t traded today. Stock markets are closed on weekends and holidays, and a fund&apos;s change appears once today&apos;s NAV is published, usually late evening.
          </p>
        </div>
      </Card>
    );
  }

  const yesterdayOf = (m: Mover) => convert((m.position.value ?? 0) - (m.position.dayChange ?? 0), m.position.asset.currency, currency, today.rate);
  const start = cls === "all" ? today.base : movers.reduce((s, m) => s + yesterdayOf(m), 0);
  const moved = movers.reduce((s, m) => s + m.amount, 0) + (cls === "all" ? (today.fx?.amount ?? 0) : 0);
  const end = start + moved;

  const shown = all ? sorted : sorted.slice(0, SHOW);
  const rest = all ? [] : sorted.slice(SHOW);
  const steps: Step[] = shown.map((m) => ({
    key: m.position.asset.id,
    label: m.position.asset.name,
    sub: `${pct(m.pct)} · ${CLASS_META[m.position.asset.cls].short}`,
    amount: m.amount,
    mover: m,
    cls: m.position.asset.cls,
    kind: "holding",
  }));
  if (rest.length) steps.push({ key: "more", label: `${rest.length} more holding${rest.length === 1 ? "" : "s"}`, sub: "smaller moves, together", amount: rest.reduce((s, m) => s + m.amount, 0), kind: "more" });
  if (cls === "all" && today.fx) steps.push({ key: "fx", label: "Dollar–rupee rate", sub: `$1 = ₹${today.fx.from.toFixed(2)} → ₹${today.fx.to.toFixed(2)}`, amount: today.fx.amount, kind: "fx" });

  const spans = steps.map((_, i) => {
    const a = start + steps.slice(0, i).reduce((sum, x) => sum + x.amount, 0);
    return { a, b: a + steps[i].amount };
  });
  const levels = [start, end, ...spans.flatMap((s) => [s.a, s.b])];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const pad = Math.max((hi - lo) * 0.08, 1);
  const at = (v: number) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  const mood = (c?: AssetClass) => (c ? moods.find((r) => r.key === MOOD_FOR[c]) : undefined);
  const downs = movers.filter((m) => m.amount < -0.005).length;
  const ups = movers.filter((m) => m.amount > 0.005).length;
  const pctMoved = start > 0 ? (moved / start) * 100 : 0;
  const selectable = steps.filter((s) => s.mover).map((s) => s.key);

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = selectable.indexOf(selected?.position.asset.id ?? "");
    const next = selectable[Math.max(0, Math.min(selectable.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) setPicked(next);
  }

  return (
    <Card className="p-5 sm:p-6" bare={bare}>
      <header className={`flex flex-wrap items-center gap-3 justify-between ${bare ? "hidden" : ""}`}>
        <div className={`flex items-center gap-2.5 ${bare ? "hidden" : ""}`}>
          <IconTile color="var(--cat-5)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M2 4h5M5 8h6M9 12h5" />
            </svg>
          </IconTile>
          <h2 className="label text-[11.5px] text-ink">Today&apos;s movers</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[12px] text-ink-3">
            <span className="text-down">{downs} down</span> · <span className="text-up">{ups} up</span>
          </span>
          <span className={`num rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${moved < 0 ? "bg-down-soft text-down" : moved > 0 ? "bg-up-soft text-up" : "bg-sunken text-ink-2"}`}>
            {signed(moved, currency)} · {pct(pctMoved)}
          </span>
        </div>
      </header>

      <div className={`${bare ? "" : "mt-4"} flex flex-wrap gap-2`} role="tablist" aria-label="Market">
        <Chip on={cls === "all"} onClick={() => (setCls("all"), setPicked(null))} label="All markets" amount={today.total} currency={currency} />
        {today.byClass.map((c) => (
          <Chip key={c.cls} on={cls === c.cls} onClick={() => (setCls(c.cls), setPicked(null))} label={CLASS_META[c.cls].label} amount={c.total} currency={currency} dot={CLASS_META[c.cls].color} mood={mood(c.cls)} />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* The waterfall */}
        <div role="listbox" aria-label="Today's moves; use the arrow keys to move between them" tabIndex={0} onKeyDown={onKey} className="min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Row label="Yesterday's close" sub={cls === "all" ? "Everything you hold" : CLASS_META[cls].label} value={money(start, currency, { decimals: 0 })} edge>
            <span className="absolute inset-y-0 w-[2px] rounded-full bg-ink-3/70" style={{ left: `calc(${at(start)}% - 1px)` }} />
          </Row>
          {steps.map((s, i) => {
            const { a, b } = spans[i];
            const up = s.amount >= 0;
            const on = s.mover && selected?.position.asset.id === s.key;
            return (
              <Row
                key={s.key}
                badge={s.mover ? <AssetBadge position={s.mover.position} size={30} /> : <span className="grid size-[30px] place-items-center rounded-full bg-sunken text-[11px] font-bold text-ink-3 ring-1 ring-line">{s.kind === "fx" ? "₹$" : "+"}</span>}
                label={s.label}
                sub={s.sub}
                value={signed(s.amount, currency)}
                tone={s.amount}
                lit={!!on}
                onClick={s.mover ? () => setPicked(s.key) : s.kind === "more" ? () => setAll(true) : undefined}
                delay={i}
              >
                <span className="absolute inset-y-0 border-l border-dashed border-ink-3/30" style={{ left: `${at(a)}%` }} />
                <span
                  className="bar-grow absolute inset-y-[3px] rounded-[5px]"
                  style={{
                    left: `${Math.min(at(a), at(b))}%`,
                    width: `${Math.max(0.6, Math.abs(at(b) - at(a)))}%`,
                    background: up ? "linear-gradient(90deg, color-mix(in srgb, var(--up) 55%, transparent), var(--up))" : "linear-gradient(270deg, color-mix(in srgb, var(--down) 55%, transparent), var(--down))",
                    boxShadow: on ? `0 0 14px ${up ? "var(--up)" : "var(--down)"}` : undefined,
                    transformOrigin: up ? "left" : "right",
                    animationDelay: `${i * 35}ms`,
                  }}
                />
              </Row>
            );
          })}
          <Row label="Now" sub={`${signed(moved, currency)} since yesterday's close`} value={money(end, currency, { decimals: 0 })} edge strong>
            <span className="absolute inset-y-0 w-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" style={{ left: `calc(${at(end)}% - 1px)` }} />
          </Row>
          {sorted.length > SHOW && (
            <div className="mt-2 flex justify-center">
              <button type="button" onClick={() => setAll((v) => !v)} className="press rounded-full px-3 py-1.5 text-[12px] font-semibold text-accent ring-1 ring-line hover:bg-sunken">
                {all ? "Show fewer" : `Show all ${sorted.length}`}
              </button>
            </div>
          )}
        </div>

        {/* Detail panel for the selected move */}
        {selected && (
          <Detail
            key={selected.position.asset.id}
            m={selected}
            currency={currency}
            path={path}
            closes={closes[selected.position.asset.id]}
            marketQuote={market[qk(BENCH[selected.position.asset.cls].item)]}
            mood={mood(selected.position.asset.cls)}
            share={moved !== 0 ? selected.amount / moved : 0}
            onOpen={() => onOpen(selected.position.asset.id)}
          />
        )}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
        Each step is units held × (latest price − previous close){today.fx ? `, at $1 = ₹${today.rate.toFixed(2)}` : ""}. Markets are compared with Nifty 50 (Indian stocks and funds), the S&amp;P 500 and Bitcoin.
      </p>
    </Card>
  );
}

/** Everything about one move, in plain words. */
function Detail({
  m,
  currency,
  path,
  closes,
  marketQuote,
  mood,
  share,
  onOpen,
}: {
  m: Mover;
  currency: Currency;
  path: Candle[] | null;
  closes?: Candle[];
  marketQuote?: Quote;
  mood?: MoodReading;
  share: number;
  onOpen: () => void;
}) {
  const p = m.position;
  const cls = p.asset.cls;
  const bench = BENCH[cls];
  const isBench = qk({ cls, symbol: p.asset.symbol, currency: p.asset.currency }) === qk(bench.item);
  const mk = marketQuote && marketQuote.prevClose ? (marketQuote.price / marketQuote.prevClose - 1) * 100 : null;
  const up = m.amount >= 0;

  // Market or its own move, in words.
  let verdict = "";
  if (isBench) verdict = `This is the benchmark for ${CLASS_META[cls].label.toLowerCase()}.`;
  else if (mk === null) verdict = "The market's move isn't available right now.";
  else if (Math.abs(m.pct) < 0.15) verdict = "Barely moved today.";
  else if (Math.abs(mk) < 0.15) verdict = `Its market was flat, so this is its own move.`;
  else if (Math.sign(mk) !== Math.sign(m.pct)) verdict = `It moved against its market — ${m.pct < 0 ? "fell while the market rose" : "rose while the market fell"}.`;
  else {
    const ratio = m.pct / mk;
    verdict =
      ratio > 1.8
        ? `It ${m.pct < 0 ? "fell" : "rose"} ${ratio.toFixed(1)}× as much as its market — mostly its own move.`
        : ratio >= 0.6
          ? `It moved with its market — mostly a market-wide move.`
          : `It ${m.pct < 0 ? "fell less" : "rose less"} than its market.`;
  }

  // Bigger picture from daily closes.
  const v = (closes ?? []).map((c) => c.c);
  const priceNow = p.price ?? v.at(-1) ?? 0;
  if (v.length && Math.abs(v[v.length - 1] - priceNow) / (priceNow || 1) > 1e-6) v.push(priceNow);
  const dir = Math.sign(m.pct);
  let streak = 0;
  for (let i = v.length - 1; i > 0 && dir !== 0 && Math.sign(v[i] - v[i - 1]) === dir; i--) streak++;
  const back = (days: number) => {
    const c = closes ?? [];
    // Count back from the latest daily close, so render stays pure.
    const target = (c.at(-1)?.t ?? 0) - days * 86400;
    const hit = [...c].reverse().find((x) => x.t <= target);
    return hit && hit.c > 0 ? (priceNow / hit.c - 1) * 100 : null;
  };
  const w1 = back(7);
  const m1 = back(30);
  const yhi = closes?.length ? Math.max(priceNow, ...closes.map((x) => (x.h > 0 ? x.h : x.c))) : null;
  const ylo = closes?.length ? Math.min(priceNow, ...closes.map((x) => (x.l > 0 ? x.l : x.c))) : null;
  const rangeAt = yhi !== null && ylo !== null && yhi > ylo ? (priceNow - ylo) / (yhi - ylo) : null;

  // Price path: intraday for stocks and crypto; the last few NAVs for funds.
  const series = cls === "mf" ? (closes ?? []).slice(-8) : path;

  return (
    <aside className="item-in min-w-0 rounded-2xl bg-sunken/60 p-4 ring-1 ring-line" aria-live="polite">
      <div className="flex items-center gap-3">
        <AssetBadge position={p} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{p.asset.name}</p>
          <p className="num text-[11.5px] text-ink-3">
            {CLASS_META[cls].short} · {fmtPrice(p.price ?? 0, p.asset.currency)}
          </p>
        </div>
        <button type="button" onClick={onOpen} className="press shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-accent ring-1 ring-line hover:bg-surface">
          Open →
        </button>
      </div>

      <div className="mt-4 flex items-baseline gap-2.5">
        <span className={`num text-[28px] font-light leading-none tracking-[-0.03em] ${up ? "text-up" : "text-down"}`}>{signed(m.amount, currency)}</span>
        <span className={`num text-[13px] font-semibold ${up ? "text-up" : "text-down"}`}>{pct(m.pct)}</span>
      </div>
      <p className="num mt-1 text-[11.5px] text-ink-3">
        {share < 0 ? "Went against today's overall move" : share < 0.005 ? "A small part of today's move" : `${Math.round(share * 100)}% of today's ${m.amount < 0 ? "drop" : "gain"}`}
      </p>

      <Section title={cls === "mf" ? "Last NAVs" : "Today's price path"}>
        <PricePath candles={series} prevClose={p.prevClose} up={up} loading={cls !== "mf" && path === null} />
      </Section>

      <Section title="Market or its own move?">
        {!isBench && mk !== null && (
          <div className="space-y-1.5">
            <CompareBar label={p.asset.ticker && p.asset.ticker.length <= 12 ? p.asset.ticker.replace(/\.(NS|BO)$/, "") : "This holding"} value={m.pct} max={Math.max(Math.abs(m.pct), Math.abs(mk), 0.5)} />
            <CompareBar label={bench.label} value={mk} max={Math.max(Math.abs(m.pct), Math.abs(mk), 0.5)} muted />
          </div>
        )}
        <p className="mt-2 text-[12.5px] leading-snug text-ink-2">{verdict}</p>
        {mood && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <span className="size-1.5 rounded-full" style={{ background: moodColor(moodPosition(mood)) }} />
            {mood.scale === "vix" ? "US VIX" : cls === "crypto" ? "Crypto mood" : "India mood"}: <span style={{ color: moodColor(moodPosition(mood)) }}>{mood.label}</span> ({mood.value})
          </p>
        )}
      </Section>

      <Section title="Bigger picture">
        <div className="grid grid-cols-3 gap-2">
          <Mini label="Streak" value={streak ? `${streak} ${dir > 0 ? "up" : "down"}` : "–"} tone={streak ? dir : 0} sub={streak ? `day${streak === 1 ? "" : "s"} in a row` : "no streak"} />
          <Mini label="1 week" value={w1 === null ? "–" : pct(w1)} tone={w1 ?? 0} />
          <Mini label="1 month" value={m1 === null ? "–" : pct(m1)} tone={m1 ?? 0} />
        </div>
        {rangeAt !== null && yhi !== null && ylo !== null && (
          <div className="mt-3">
            <div className="relative h-[5px] rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--down)_35%,transparent),color-mix(in_srgb,var(--up)_35%,transparent))]">
              <span className="absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ left: `${rangeAt * 100}%`, background: CLASS_META[cls].color, boxShadow: `0 0 8px ${CLASS_META[cls].color}` }} />
            </div>
            <p className="num mt-1.5 flex justify-between text-[10.5px] text-ink-3">
              <span>1-yr low {compact(ylo, p.asset.currency)}</span>
              <span>{Math.round(rangeAt * 100)}% of range</span>
              <span>high {compact(yhi, p.asset.currency)}</span>
            </p>
          </div>
        )}
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="label mb-2 text-[9.5px] text-ink-3">{title}</p>
      {children}
    </div>
  );
}

function PricePath({ candles, prevClose, up, loading }: { candles: Candle[] | null | undefined; prevClose: number | null; up: boolean; loading: boolean }) {
  if (loading) return <div className="skeleton h-[84px]" />;
  if (!candles || candles.length < 2) return <p className="py-6 text-center text-[12px] text-ink-3">No price path for today yet.</p>;
  const W = 320;
  const H = 84;
  const vals = candles.map((c) => c.c);
  const lo = Math.min(...vals, prevClose ?? Infinity);
  const hi = Math.max(...vals, prevClose ?? -Infinity);
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`);
  const col = up ? "var(--up)" : "var(--down)";
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const isDaily = candles.length > 1 && candles[1].t - candles[0].t > 20 * 3600;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[84px] w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="path-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity={0.28} />
            <stop offset="100%" stopColor={col} stopOpacity={0} />
          </linearGradient>
        </defs>
        {prevClose !== null && <line x1={0} x2={W} y1={y(prevClose)} y2={y(prevClose)} stroke="var(--ink-3)" strokeOpacity={0.6} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        <path d={`M${pts.join("L")}L${W},${H}L0,${H}Z`} fill="url(#path-fill)" />
        <path d={`M${pts.join("L")}`} fill="none" stroke={col} strokeWidth={1.6} vectorEffect="non-scaling-stroke" pathLength={1} className="draw" />
      </svg>
      <p className="num mt-1 flex justify-between text-[10.5px] text-ink-3">
        <span>{isDaily ? day(candles[0].t * 1000) : time(candles[0].t)}</span>
        {prevClose !== null && <span>- - previous close</span>}
        <span>{isDaily ? day(candles[candles.length - 1].t * 1000) : time(candles[candles.length - 1].t)}</span>
      </p>
    </div>
  );
}

function CompareBar({ label, value, max, muted }: { label: string; value: number; max: number; muted?: boolean }) {
  const w = Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)_56px] items-center gap-2 text-[11.5px]">
      <span className={`truncate ${muted ? "text-ink-3" : "font-semibold"}`}>{label}</span>
      <span className="relative h-2 rounded-full bg-surface ring-1 ring-line">
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink-3/50" />
        <span
          className="seg-grow absolute inset-y-0 rounded-full"
          style={{
            left: value >= 0 ? "50%" : `${50 - w}%`,
            width: `${w}%`,
            background: value >= 0 ? "var(--up)" : "var(--down)",
            opacity: muted ? 0.5 : 1,
            transformOrigin: value >= 0 ? "left" : "right",
          }}
        />
      </span>
      <span className={`num text-right font-semibold ${value >= 0 ? "text-up" : "text-down"}`}>{pct(value)}</span>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-2.5 py-2 ring-1 ring-line">
      <p className="label truncate text-[9px] text-ink-3">{label}</p>
      <p className={`num mt-1 truncate text-[14px] font-semibold ${value === "–" ? "" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : ""}`}>{value}</p>
      {sub && <p className="truncate text-[10px] text-ink-3">{sub}</p>}
    </div>
  );
}

function Chip({ on, onClick, label, amount, currency, dot, mood }: { on: boolean; onClick: () => void; label: string; amount: number; currency: Currency; dot?: string; mood?: MoodReading }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`press flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {label}
      <span className={`num ${on ? "" : amount < 0 ? "text-down" : amount > 0 ? "text-up" : ""}`}>{compact(amount, currency)}</span>
      {mood && (
        <span className="num flex items-center gap-1 border-l pl-2 text-[11px] font-medium opacity-80" style={{ borderColor: "currentColor" }} title={`${mood.source}: ${mood.label}`}>
          <span className="size-1.5 rounded-full" style={{ background: moodColor(moodPosition(mood)) }} />
          {mood.value}
        </span>
      )}
    </button>
  );
}

function Row({
  badge,
  label,
  sub,
  value,
  tone,
  edge,
  strong,
  lit,
  onClick,
  delay = 0,
  children,
}: {
  badge?: React.ReactNode;
  label: string;
  sub: React.ReactNode;
  value: string;
  tone?: number;
  edge?: boolean;
  strong?: boolean;
  lit?: boolean;
  onClick?: () => void;
  delay?: number;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {badge ?? <span className="size-[30px] shrink-0" />}
        <span className="min-w-0">
          <span className={`block truncate text-[13px] ${edge ? "label text-[10.5px] text-ink-2" : "font-semibold"}`}>{label}</span>
          <span className="num block truncate text-[11px] text-ink-3">{sub}</span>
        </span>
      </span>
      <span className="relative hidden h-7 sm:block">{children}</span>
      <span className={`num text-right ${strong ? "text-[16px] font-semibold" : edge ? "text-[13px] font-semibold text-ink-2" : `text-[13.5px] font-semibold ${tone !== undefined && tone < 0 ? "text-down" : tone !== undefined && tone > 0 ? "text-up" : ""}`}`}>{value}</span>
    </>
  );
  const cls = `item-in relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-2 py-1.5 text-left transition-colors sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)_92px] ${lit ? "bg-sunken ring-1 ring-line" : onClick ? "hover:bg-sunken/60" : ""} ${edge ? "border-y border-line/70" : ""}`;
  return onClick ? (
    <button type="button" role="option" aria-selected={!!lit} tabIndex={-1} className={`press ${cls}`} style={{ animationDelay: `${delay * 30}ms` }} onClick={onClick}>
      {lit && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden />}
      {body}
    </button>
  ) : (
    <div className={cls} style={{ animationDelay: `${delay * 30}ms` }}>
      {body}
    </div>
  );
}
